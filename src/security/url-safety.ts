
import { BadRequestException } from '@nestjs/common';
import * as dns from 'dns';
import * as net from 'net';
import { promisify } from 'util';

const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

// Private IP Ranges (CIDR)
// 127.0.0.0/8
// 10.0.0.0/8
// 172.16.0.0/12
// 192.168.0.0/16
// 169.254.0.0/16 (Link Local)
// 100.64.0.0/10 (Shared Address Space)
// ::1 (IPv6 Loopback)
// fc00::/7 (Unique Local)
// fe80::/10 (Link Local)

function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map((p) => parseInt(p, 10));
    // 127.0.0.0/8
    if (parts[0] === 127) return true;
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 100.64.0.0/10
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 0.0.0.0/8
    if (parts[0] === 0) return true;
    return false;
  } else if (net.isIPv6(ip)) {
    // Normalize IPv6
    // Simplistic check for standard prefixes
    const lowerIP = ip.toLowerCase();
    
    // Loopback
    if (lowerIP === '::1' || lowerIP === '0:0:0:0:0:0:0:1') return true;
    // Link Local fe80::/10
    if (lowerIP.startsWith('fe8') || lowerIP.startsWith('fe9') || lowerIP.startsWith('fea') || lowerIP.startsWith('feb')) return true;
    // Unique Local fc00::/7 (fc00... to fdff...)
    if (lowerIP.startsWith('fc') || lowerIP.startsWith('fd')) return true;
    
    // IPv4 mapped
    if (lowerIP.startsWith('::ffff:')) {
      return isPrivateIP(lowerIP.substring(7));
    }
    
    return false;
  }
  return false;
}

export interface ValidationResult {
  ok: boolean;
  ip?: string;
  error?: string;
}

export async function validateOutboundUrl(urlStr: string): Promise<ValidationResult> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch (e) {
    throw new BadRequestException('Invalid URL format');
  }

  // 1. Scheme Check
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException('Only HTTP/HTTPS protocols are allowed');
  }

  // Enforce HTTPS validation if required globally, but for now we allow http for broader compatibility if safe
  // Ideally, block http except for verified public domains, but explicit block of private ranges is the main SSRF defense.

  const hostname = url.hostname;

  // 2. Hostname Check (quick IP check)
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new BadRequestException('Access to private IP addresses is forbidden');
    }
    return { ok: true, ip: hostname };
  }

  // 3. DNS Resolution (Rebinding Defense)
  // We resolve the hostname to check if it points to a private IP.
  // Note: Race condition (TOCTOU) is still possible unless we use the resolved IP for the request.
  // Best practice: The caller should ideally use a custom agent that repeats this check or use the resolved IP.
  // However, verifying DNS here blocks 99% of blind SSRF / naive attacks.

  try {
    const ips4 = await resolve4(hostname).catch(() => []);
    const ips6 = await resolve6(hostname).catch(() => []);

    if (ips4.length === 0 && ips6.length === 0) {
       // It might be unreachable, but that's not a security risk per se, unless it resolves internally later.
       // However, if we can't resolve it, we can't validate it.
       // We'll proceed with caution or fail. Let's fail to be safe.
       throw new BadRequestException('Could not resolve hostname');
    }

    for (const ip of ips4) {
      if (isPrivateIP(ip)) {
        throw new BadRequestException(`Hostname resolves to private IP: ${ip}`);
      }
    }

    for (const ip of ips6) {
      if (isPrivateIP(ip)) {
        throw new BadRequestException(`Hostname resolves to private IP: ${ip}`);
      }
    }

    return { ok: true };

  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException('DNS resolution failed or invalid hostname');
  }
}
