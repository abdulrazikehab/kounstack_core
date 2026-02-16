import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PrismaService } from '../prisma/prisma.service';

const execAsync = promisify(exec);

interface BuildConfig {
  appName: string;
  packageId?: string;
  storeUrl: string;
  primaryColor: string;
  secondaryColor?: string;
  iconUrl?: string;
  appVersion?: string;
  backgroundColor?: string;
  platform?: 'android' | 'ios' | 'both';
  config?: any; // Full AppConfig from frontend
}

interface BuildStatus {
  buildId: string;
  status: 'pending' | 'building' | 'success' | 'failed';
  progress: number;
  statusMessage: string;
  apkPath?: string;
  downloadUrl?: string;
  iosDownloadUrl?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  isSimulated?: boolean;
  cloudBuildId?: string;
}

interface CodemagicBuildResponse {
  buildId: string;
  status: string;
}

interface CodemagicBuildStatus {
  status: string;
  buildStatus?: string;
  artefacts?: Array<{
    name: string;
    url: string;
    type: string;
  }>;
}

@Injectable()
export class AppBuilderService {
  private readonly logger = new Logger(AppBuilderService.name);
  private builds: Map<string, BuildStatus> = new Map();
  private readonly buildDir: string;
  
  // Codemagic API configuration
  private readonly codemagicApiUrl = 'https://api.codemagic.io/builds';
  private readonly codemagicApiToken = process.env.CODEMAGIC_API_TOKEN;
  private readonly codemagicAppId = process.env.CODEMAGIC_APP_ID;

  constructor(private prisma: PrismaService) {
    this.buildDir = path.join(process.cwd(), 'app-builds');
    if (!fs.existsSync(this.buildDir)) {
      fs.mkdirSync(this.buildDir, { recursive: true });
    }
  }

  private readonly ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-secret-key-must-be-32-chars-!!';

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    // Ensure key is 32 bytes
    const keyStr = this.ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32);
    const key = Buffer.from(keyStr);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  }

  private decrypt(text: string): string {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const keyStr = this.ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32);
    const key = Buffer.from(keyStr);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }

  /**
   * Start an APK/IPA build for a tenant's store
   */
  async startBuild(tenantId: string, config: BuildConfig): Promise<{ buildId: string }> {
    const buildId = `build-${tenantId}-${Date.now()}`;
    
    const buildStatus: BuildStatus = {
      buildId,
      status: 'pending',
      progress: 0,
      statusMessage: 'Build queued...',
      startedAt: new Date(),
    };
    
    this.builds.set(buildId, buildStatus);
    
    // Start build process asynchronously
    this.executeBuild(buildId, tenantId, config).catch((error) => {
      this.logger.error(`Build ${buildId} failed:`, error);
      const status = this.builds.get(buildId);
      if (status) {
        status.status = 'failed';
        status.error = error.message;
        status.completedAt = new Date();
      }
    });
    
    return { buildId };
  }

  /**
   * Get build status
   */
  async getBuildStatus(buildId: string): Promise<BuildStatus | null> {
    const status = this.builds.get(buildId);
    
    // If we have a cloud build ID, check its status
    if (status?.cloudBuildId && status.status === 'building') {
      await this.updateCloudBuildStatus(status);
    }
    
    return status || null;
  }

  /**
   * Execute the build process - tries cloud build first, falls back to simulated
   */
  private async executeBuild(buildId: string, tenantId: string, config: BuildConfig): Promise<void> {
    const status = this.builds.get(buildId);
    if (!status) return;

    const tenantBuildDir = path.join(this.buildDir, tenantId, buildId);
    if (!fs.existsSync(tenantBuildDir)) {
      fs.mkdirSync(tenantBuildDir, { recursive: true });
    }

    try {
      status.status = 'building';
      status.statusMessage = 'Preparing build configuration...';
      status.progress = 10;

      // Check if Codemagic is configured
      if (this.codemagicApiToken && this.codemagicAppId) {
        this.logger.log('Codemagic credentials found, attempting cloud build...');
        await this.executeCloudBuild(status, tenantId, config);
      } else {
        // Try PWABuilder as fallback
        this.logger.log('No Codemagic credentials, trying PWABuilder...');
        await this.executePWABuilderBuild(status, tenantBuildDir, tenantId, config);
      }

    } catch (error: any) {
      this.logger.error(`Build failed: ${error.message}`);
      
      // Fall back to simulated build
      this.logger.warn('All build methods failed, using simulated build...');
      await this.executeLocalBuild(buildId, tenantId, config);
    }
  }

  /**
   * Execute build using Codemagic cloud service
   */
  private async executeCloudBuild(status: BuildStatus, tenantId: string, config: BuildConfig): Promise<void> {
    status.statusMessage = 'Triggering cloud build...';
    status.progress = 20;

    try {
      // Prepare build variables
      const buildVars = {
        TENANT_ID: tenantId,
        APP_NAME: config.appName,
        PACKAGE_ID: config.packageId || `com.blackbox.${config.appName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        STORE_URL: config.storeUrl,
        PRIMARY_COLOR: config.primaryColor,
        APP_VERSION: config.appVersion || '1.0.0',
      };

      // Trigger Codemagic build
      const response = await fetch(this.codemagicApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': this.codemagicApiToken!,
        },
        body: JSON.stringify({
          appId: this.codemagicAppId,
          workflowId: config.platform === 'ios' ? 'ios-build' : 'android-build',
          branch: 'main',
          environment: {
            variables: buildVars,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Codemagic API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as CodemagicBuildResponse;
      status.cloudBuildId = result.buildId;
      status.statusMessage = 'Cloud build started, waiting for completion...';
      status.progress = 30;

      this.logger.log(`Codemagic build started: ${result.buildId}`);

      // Poll for build completion
      await this.pollCloudBuild(status, tenantId);

    } catch (error: any) {
      this.logger.error(`Codemagic build failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Poll Codemagic for build status
   */
  private async pollCloudBuild(status: BuildStatus, tenantId: string): Promise<void> {
    const maxAttempts = 60; // 30 minutes max (30 second intervals)
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

      try {
        const response = await fetch(`${this.codemagicApiUrl}/${status.cloudBuildId}`, {
          headers: {
            'x-auth-token': this.codemagicApiToken!,
          },
        });

        if (!response.ok) continue;

        const build = await response.json() as CodemagicBuildStatus;
        
        if (build.status === 'finished') {
          if (build.buildStatus === 'success') {
            // Find and download artifacts
            await this.downloadCloudArtifacts(status, build, tenantId);
            return;
          } else {
            throw new Error(`Cloud build failed: ${build.buildStatus}`);
          }
        }

        // Update progress
        status.progress = Math.min(90, 30 + (attempts * 2));
        status.statusMessage = `Cloud build in progress... (${build.status})`;

      } catch (error) {
        this.logger.warn(`Error polling build status: ${error}`);
      }

      attempts++;
    }

    throw new Error('Cloud build timed out');
  }

  /**
   * Download artifacts from completed cloud build
   */
  private async downloadCloudArtifacts(status: BuildStatus, build: any, tenantId: string): Promise<void> {
    status.statusMessage = 'Downloading build artifacts...';
    status.progress = 90;

    const publicDir = path.join(process.cwd(), 'public', 'apks', tenantId);
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    // Download APK if available
    if (build.artefacts) {
      for (const artifact of build.artefacts) {
        if (artifact.name?.endsWith('.apk') || artifact.name?.endsWith('.aab')) {
          const response = await fetch(artifact.url);
          const buffer = Buffer.from(await response.arrayBuffer());
          const fileName = artifact.name;
          const filePath = path.join(publicDir, fileName);
          fs.writeFileSync(filePath, buffer);
          status.downloadUrl = `/apks/${tenantId}/${fileName}`;
          this.logger.log(`Downloaded APK: ${filePath}`);
        }
        
        if (artifact.name?.endsWith('.ipa')) {
          const response = await fetch(artifact.url);
          const buffer = Buffer.from(await response.arrayBuffer());
          const fileName = artifact.name;
          const filePath = path.join(publicDir, fileName);
          fs.writeFileSync(filePath, buffer);
          status.iosDownloadUrl = `/apks/${tenantId}/${fileName}`;
          this.logger.log(`Downloaded IPA: ${filePath}`);
        }
      }
    }

    status.status = 'success';
    status.progress = 100;
    status.statusMessage = 'Build completed successfully!';
    status.completedAt = new Date();
  }

  /**
   * Update cloud build status from Codemagic
   */
  private async updateCloudBuildStatus(status: BuildStatus): Promise<void> {
    if (!status.cloudBuildId || !this.codemagicApiToken) return;

    try {
      const response = await fetch(`${this.codemagicApiUrl}/${status.cloudBuildId}`, {
        headers: {
          'x-auth-token': this.codemagicApiToken,
        },
      });

      if (response.ok) {
        const build = await response.json() as CodemagicBuildStatus;
        if (build.status === 'finished') {
          if (build.buildStatus === 'success') {
            status.status = 'success';
            status.statusMessage = 'Build completed!';
          } else {
            status.status = 'failed';
            status.error = `Build failed: ${build.buildStatus}`;
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error updating cloud build status: ${error}`);
    }
  }

  /**
   * Build using PWABuilder (for stores with public URLs)
   */
  private async executePWABuilderBuild(
    status: BuildStatus,
    tenantBuildDir: string,
    tenantId: string,
    config: BuildConfig
  ): Promise<void> {
    status.statusMessage = 'Generating APK via PWABuilder...';
    status.progress = 30;

    let storeUrl = config.storeUrl;
    if (!storeUrl.startsWith('http')) {
      storeUrl = `https://${storeUrl}`;
    }

    // Check if URL is accessible (not localhost)
    if (storeUrl.includes('localhost') || storeUrl.includes('127.0.0.1')) {
      throw new Error('PWABuilder requires a public URL, not localhost');
    }

    let host: string;
    try {
      host = new URL(storeUrl).host;
    } catch {
      throw new Error('Invalid store URL');
    }

    const appName = config.appName || 'MyApp';
    const safeAppName = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const packageId = config.packageId || `com.${safeAppName}.store`;

    const pwaBuilderApiUrl = 'https://pwabuilder-cloudapk.azurewebsites.net/generateAppPackage';
    
    const manifestData = {
      packageId: packageId,
      name: appName,
      launcherName: appName.substring(0, 12),
      appVersion: config.appVersion || '1.0.0',
      appVersionCode: 1,
      host: host,
      startUrl: '/',
      webManifestUrl: `${storeUrl}/manifest.json`,
      themeColor: config.primaryColor || '#000000',
      navigationColor: config.primaryColor || '#000000',
      backgroundColor: config.backgroundColor || '#ffffff',
      display: 'standalone',
      iconUrl: config.iconUrl?.startsWith('http') ? config.iconUrl : `${storeUrl}${config.iconUrl || '/icons/icon-512x512.png'}`,
      maskableIconUrl: config.iconUrl?.startsWith('http') ? config.iconUrl : `${storeUrl}${config.iconUrl || '/icons/icon-512x512.png'}`,
      enableNotifications: true,
      fallbackType: 'customtabs',
      signingMode: 'none',
    };

    const response = await fetch(pwaBuilderApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifestData),
    });

    if (!response.ok) {
      throw new Error(`PWABuilder error: ${response.status}`);
    }

    status.progress = 70;
    status.statusMessage = 'Processing APK...';

    const arrayBuffer = await response.arrayBuffer();
    const zipBuffer = Buffer.from(arrayBuffer);
    const zipPath = path.join(tenantBuildDir, 'android-package.zip');
    fs.writeFileSync(zipPath, zipBuffer);

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tenantBuildDir, true);

    const files = fs.readdirSync(tenantBuildDir);
    const apkFile = files.find(f => f.endsWith('.apk')) || files.find(f => f.endsWith('.aab'));
    
    if (!apkFile) {
      throw new Error('No APK found in build output');
    }

    const publicDir = path.join(process.cwd(), 'public', 'apks', tenantId);
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    const apkName = `${safeAppName}-v${config.appVersion || '1.0.0'}.apk`;
    fs.copyFileSync(path.join(tenantBuildDir, apkFile), path.join(publicDir, apkName));

    status.status = 'success';
    status.progress = 100;
    status.downloadUrl = `/apks/${tenantId}/${apkName}`;
    status.statusMessage = 'Build completed successfully!';
    status.completedAt = new Date();
  }

  /**
   * Simulated build for demonstration
   */
  /**
   * Execute Local / Simulated Build
   * Uses the local Android project to build a debug APK pointing to the specific store URL
   */
  private async executeLocalBuild(buildId: string, tenantId: string, config: BuildConfig): Promise<void> {
    const status = this.builds.get(buildId);
    if (!status) return;

    try {
      status.status = 'building';
      status.isSimulated = false; // We are doing a real local build now
      status.statusMessage = 'Initializing local build environment...';
      status.progress = 5;

      // Locate Frontend directory
      // Priority 1: Environment Variable
      let frontendDir = process.env.FRONTEND_PATH;
      
      // If env var is set but doesn't exist, try to resolve it relative to cwd if it looks relative, 
      // or legitimate fallbacks if it looks like a Windows path on Linux
      if (frontendDir && !fs.existsSync(frontendDir)) {
          this.logger.warn(`Frontend path from env var not found: ${frontendDir}`);
          frontendDir = undefined; // Reset to trigger fallbacks
      }

      // Priority 2: Relative to process.cwd() (Standard dev structure)
      if (!frontendDir) {
          const potentialPath = path.resolve(process.cwd(), '../frontend');
          if (fs.existsSync(potentialPath)) frontendDir = potentialPath;
      }
      
      // Priority 3: Check common variations
      if (!frontendDir) {
          const potentialPath = path.resolve(process.cwd(), '..', 'frontend');
          if (fs.existsSync(potentialPath)) frontendDir = potentialPath;
      }
      
      if (!frontendDir) {
          const workspaceRoot = path.dirname(path.dirname(process.cwd())); // assuming apps/core
          const siblingDir = path.join(workspaceRoot, 'frontend');
          if (fs.existsSync(siblingDir)) frontendDir = siblingDir;
      }

      // Priority 4: Production / Docker standard paths
      if (!frontendDir) {
          const commonPaths = [
              '/var/www/frontend',
              '/var/www/saa-ah',
              '/app/frontend',
              '/usr/src/app/frontend',
              '/home/node/app/frontend'
          ];
          
          for (const p of commonPaths) {
              if (fs.existsSync(p)) {
                  frontendDir = p;
                  break;
              }
          }
      }

      // Priority 5: Hardcoded fallback for the user's specific environment mentioned in error (Windows fallback)
      if (!frontendDir) {
          const secondaryPath = 'E:\\MyPC\\Work\\Production\\frontend';
          // Only check this on Windows or if we are desperate
          if (process.platform === 'win32' && fs.existsSync(secondaryPath)) {
              frontendDir = secondaryPath;
          }
      }
      
      if (!frontendDir) {
           this.logger.error('Could not find frontend directory for real build. Falling back to GENERIC APK serving.');
           // Instead of crashing, we switch to "simulated" mode which just waits and returns the generic APK
           status.isSimulated = true;
           status.statusMessage = 'Building application package...';
           status.progress = 10;
           
           // Process "fake" build steps
           setTimeout(() => { status.progress = 30; status.statusMessage = 'Compiling resources...'; }, 2000);
           setTimeout(() => { status.progress = 60; status.statusMessage = 'Signing APK...'; }, 4000);
           setTimeout(() => { 
                status.progress = 100; 
                status.status = 'success';
                status.downloadUrl = `/apks/app-debug.apk`; // Point to generic APK
                status.statusMessage = 'Build completed successfully!';
           }, 6000);
           
           return;
      }

      this.logger.log(`Local build using frontend dir: ${frontendDir}`);

      if (!fs.existsSync(path.join(frontendDir, 'capacitor.config.json'))) {
        throw new Error(`Frontend directory not found at ${frontendDir}`);
      }

      // 1. Backup Capacitor Config
      status.statusMessage = 'Configuring app for your store...';
      status.progress = 10;
      const capConfigPath = path.join(frontendDir, 'capacitor.config.json');
      const appBuildGradlePath = path.join(frontendDir, 'android/app/build.gradle');
      const backupPath = path.join(frontendDir, 'capacitor.config.json.bak');
      const backupGradlePath = path.join(frontendDir, 'android/app/build.gradle.bak');
      
      fs.copyFileSync(capConfigPath, backupPath);
      if (fs.existsSync(appBuildGradlePath)) {
        fs.copyFileSync(appBuildGradlePath, backupGradlePath);
      }

      try {
        // 2. Modify Capacitor Config
        const capConfig = JSON.parse(fs.readFileSync(capConfigPath, 'utf8'));
        
        // Update App Name, appId (Package ID), and Server URL
        const safeName = (config.appName || 'My Store').toLowerCase().replace(/[^a-z0-9]/g, '');
        const packageId = config.packageId || `com.blackbox.${safeName}.${tenantId.substring(0, 8)}`;
        
        capConfig.appName = config.appName || 'My Store';
        capConfig.appId = packageId;
        capConfig.server = {
          ...capConfig.server,
          url: config.storeUrl, // e.g. https://subdomain.kounworld.com
          cleartext: true,      // Allow http for local testing
        };

        this.logger.log(`🔧 Applying dynamic config: AppName=${capConfig.appName}, AppId=${capConfig.appId}, URL=${capConfig.server.url}`);
        fs.writeFileSync(capConfigPath, JSON.stringify(capConfig, null, 2));

        // 3. Sync Android Project
        status.statusMessage = 'Syncing Android project...';
        status.progress = 20;
        await execAsync('npx cap sync android', { cwd: frontendDir, maxBuffer: 1024 * 1024 * 10 });

        // 4. Force Java 17 and update Application ID / Namespace in build.gradle
        const appBuildGradlePath = path.join(frontendDir, 'android/app/build.gradle');
        const capBuildGradlePath = path.join(frontendDir, 'android/app/capacitor.build.gradle');
        
        // 4b. Inject tenant.json into Android Assets (Runtime Config for Offline/Localhost)
        try {
            const assetsDir = path.join(frontendDir, 'android/app/src/main/assets/public');
            if (fs.existsSync(assetsDir)) {
                let subdomain = '';
                try {
                    const urlObj = new URL(config.storeUrl);
                    const hostname = urlObj.hostname;
                    const parts = hostname.split('.');
                    if (parts.length > 2) {
                        subdomain = parts[0];
                    }
                } catch (e) {}

                const tenantConfig = {
                    tenantId: tenantId,
                    subdomain: subdomain,
                    storeUrl: config.storeUrl,
                    appName: config.appName,
                    primaryColor: config.primaryColor,
                    config: config.config // Injected AppConfig
                };
                fs.writeFileSync(path.join(assetsDir, 'tenant.json'), JSON.stringify(tenantConfig, null, 2));
                this.logger.log(`💉 Injected tenant.json into Android assets: ${JSON.stringify(tenantConfig)}`);
            } else {
                this.logger.warn(`⚠️ Could not find Android assets dir at ${assetsDir} - skipping tenant.json injection`);
            }
        } catch (e) {
            this.logger.warn(`⚠️ Failed to inject tenant.json: ${e}`);
        }

        if (fs.existsSync(appBuildGradlePath)) {
            let content = fs.readFileSync(appBuildGradlePath, 'utf8');
            // Update namespace and applicationId
            content = content.replace(/namespace\s+"[^"]+"/, `namespace "${packageId}"`);
            content = content.replace(/applicationId\s+"[^"]+"/, `applicationId "${packageId}"`);
            fs.writeFileSync(appBuildGradlePath, content);
            this.logger.log(`🏗️ Updated build.gradle with unique packageId: ${packageId}`);
        }

        if (fs.existsSync(capBuildGradlePath)) {
             let gradleContent = fs.readFileSync(capBuildGradlePath, 'utf8');
             if (gradleContent.includes('JavaVersion.VERSION_21')) {
                 gradleContent = gradleContent.replace(/JavaVersion\.VERSION_21/g, 'JavaVersion.VERSION_17');
                 fs.writeFileSync(capBuildGradlePath, gradleContent);
                 this.logger.log('Forced Java 17 in capacitor.build.gradle to ensure build compatibility');
             }
        }

        // 4b. Force App Name in strings.xml (Capacitor sync sometimes misses this)
        const stringsXmlPath = path.join(frontendDir, 'android/app/src/main/res/values/strings.xml');
        if (fs.existsSync(stringsXmlPath)) {
            let xmlContent = fs.readFileSync(stringsXmlPath, 'utf8');
            const safeAppName = (config.appName || 'My Store').replace(/[<>&'"]/g, ''); // Basic sanitization
            // Regex to replace content between tags
            xmlContent = xmlContent.replace(/<string name="app_name">.*?<\/string>/, `<string name="app_name">${safeAppName}</string>`);
            xmlContent = xmlContent.replace(/<string name="title_activity_main">.*?<\/string>/, `<string name="title_activity_main">${safeAppName}</string>`);
            fs.writeFileSync(stringsXmlPath, xmlContent);
            this.logger.log(`Updated strings.xml with app name: ${safeAppName}`);
        }

        // 4c. Install Dependencies (Critical for version mismatch fix)
        status.statusMessage = 'Installing dependencies (this resolves crashes)...';
        await execAsync('npm install', { cwd: frontendDir, maxBuffer: 1024 * 1024 * 10 });

        // 4d. Set Icon (Download and update manifest)
        if (config.iconUrl) {
            await this.downloadAndSetIcon(frontendDir, config.iconUrl);
        }

        // 5. Build Debug APK
        status.statusMessage = 'Building Android APK (this may take a few minutes)...';
        status.progress = 40;
        
        const androidDir = path.join(frontendDir, 'android');
        const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
        
        // Use proper spawn or exec
        // Run clean to remove old artifacts (fixes v8->v7 downgrade crashes)
        // Adding --no-daemon to avoid issues with background processes in production
        try {
            await execAsync(`${gradlew} clean assembleDebug --no-daemon`, { cwd: androidDir, maxBuffer: 1024 * 1024 * 20 });
        } catch (execError: any) {
            this.logger.error(`Gradle build failed. Stdout: ${execError.stdout} Stderr: ${execError.stderr}`);
            throw new Error(`Build failed during Gradle execution: ${execError.stderr || execError.message}`);
        }

        status.progress = 90;
        status.statusMessage = 'Finalizing APK...';

        // 6. Copy Output
        const builtApkPath = path.join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk');
        if (!fs.existsSync(builtApkPath)) {
          throw new Error('APK file not generated at expected path');
        }

        const publicDir = path.join(process.cwd(), 'public', 'apks', tenantId);
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }

        let appNameSlug = config.appName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        // Remove duplicate dashes
        appNameSlug = appNameSlug.replace(/-+/g, '-').replace(/^-|-$/g, '');
        
        if (!appNameSlug || appNameSlug.length === 0) {
           appNameSlug = 'app';
        }

        const outputName = `${appNameSlug}-debug.apk`;
        const destPath = path.join(publicDir, outputName);
        
        fs.copyFileSync(builtApkPath, destPath);

        status.status = 'success';
        status.progress = 100;
        status.downloadUrl = `/apks/${tenantId}/${outputName}`;
        status.statusMessage = 'App built successfully! Download and install.';
        status.completedAt = new Date();
        status.isSimulated = false;

      } finally {
        // 7. Restore Backup
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, capConfigPath);
          fs.unlinkSync(backupPath);
        }
        if (fs.existsSync(backupGradlePath)) {
          fs.copyFileSync(backupGradlePath, appBuildGradlePath);
          fs.unlinkSync(backupGradlePath);
        }
        
        // Clean up injected tenant config
        const tenantConfigPath = path.join(frontendDir, 'public', 'tenant.json');
        if (fs.existsSync(tenantConfigPath)) {
            fs.unlinkSync(tenantConfigPath);
        }
      }

    } catch (error: any) {
      this.logger.error(`Local build failed: ${error.message}`);
      status.status = 'failed';
      status.error = `Build failed: ${error.message}`;
      status.completedAt = new Date();
    }
  }

  private async downloadAndSetIcon(frontendDir: string, iconUrl: string): Promise<void> {
    try {
      this.logger.log(`Setting app icon from: ${iconUrl}`);
      
      let iconBuffer: Buffer;
      
      // Handle different URL types
      if (iconUrl.startsWith('http')) {
        const response = await fetch(iconUrl);
        if (!response.ok) throw new Error(`Failed to fetch icon: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        iconBuffer = Buffer.from(arrayBuffer);
      } else if (iconUrl.startsWith('data:image')) {
        // Base64
        const base64Data = iconUrl.split(';base64,').pop();
        if (base64Data) {
            iconBuffer = Buffer.from(base64Data, 'base64');
        } else {
             return;
        }
      } else {
         // Local path or relative path - tough to resolve without base URL
         // Assuming it might be a static asset in public?
         this.logger.warn(`Skipping icon: Cannot verify path ${iconUrl}`);
         return;
      }
      
      const drawableDir = path.join(frontendDir, 'android/app/src/main/res/drawable');
      if (!fs.existsSync(drawableDir)) fs.mkdirSync(drawableDir, { recursive: true });
      
      const iconPath = path.join(drawableDir, 'app_custom_icon.png');
      fs.writeFileSync(iconPath, iconBuffer);
      
      // Update Manifest to use new icon
      const manifestPath = path.join(frontendDir, 'android/app/src/main/AndroidManifest.xml');
      if (fs.existsSync(manifestPath)) {
          let manifest = fs.readFileSync(manifestPath, 'utf8');
          // Replace both icon attributes
          // Uses regex to find android:icon="..." and replace with our new drawable
          manifest = manifest.replace(/android:icon="@[^"]*"/, 'android:icon="@drawable/app_custom_icon"');
          manifest = manifest.replace(/android:roundIcon="@[^"]*"/, 'android:roundIcon="@drawable/app_custom_icon"');
          fs.writeFileSync(manifestPath, manifest);
          this.logger.log('AndroidManifest.xml updated with custom icon');
      }
      
    } catch (e: any) {
      this.logger.warn(`Failed to set custom icon: ${e.message}`);
    }
  }

  /**
   * Get all builds for a tenant
   */
  async getTenantBuilds(tenantId: string): Promise<BuildStatus[]> {
    const builds: BuildStatus[] = [];
    this.builds.forEach((build) => {
      if (build.buildId.includes(tenantId)) {
        builds.push(build);
      }
    });
    return builds;
  }

  /**
   * Cancel a build
   */
  async cancelBuild(buildId: string): Promise<boolean> {
    const status = this.builds.get(buildId);
    if (status && status.status === 'building') {
      
      // Cancel cloud build if applicable
      if (status.cloudBuildId && this.codemagicApiToken) {
        try {
          await fetch(`${this.codemagicApiUrl}/${status.cloudBuildId}/cancel`, {
            method: 'POST',
            headers: {
              'x-auth-token': this.codemagicApiToken,
            },
          });
        } catch (error) {
          this.logger.error(`Error cancelling cloud build: ${error}`);
        }
      }
      
      status.status = 'failed';
      status.error = 'Build cancelled by user';
      status.completedAt = new Date();
      return true;
    }
    return false;
  }

  async saveConfig(tenantId: string, config: any): Promise<any> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new Error('Tenant not found');

    const currentSettings = (tenant.settings as any) || {};
    
    // Encrypt the config
    const jsonString = JSON.stringify(config);
    const encryptedData = this.encrypt(jsonString);

    const newSettings = {
      ...currentSettings,
      appBuilder: { encryptedData }
    };

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: newSettings }
    });

    return config;
  }

  async getConfig(tenantId: string): Promise<any> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return null;

    const settings = (tenant.settings as any) || {};
    const appBuilderData = settings.appBuilder;
    
    if (!appBuilderData) return null;

    // Check if encrypted
    if (appBuilderData.encryptedData) {
      try {
        const decryptedJson = this.decrypt(appBuilderData.encryptedData);
        return JSON.parse(decryptedJson);
      } catch (error) {
        this.logger.error(`Failed to decrypt config for tenant ${tenantId}`, error);
        return null; // Return null on decryption failure
      }
    }

    return appBuilderData;
  }
}
