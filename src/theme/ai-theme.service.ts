import { Injectable, BadRequestException } from '@nestjs/common';
import { randomInt } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';

interface GenerateThemeDto {
  prompt: string;
  style?: string;
}

@Injectable()
export class AiThemeService {
  private anthropic?: Anthropic;

  constructor(private prisma: PrismaService) {
    const apiKey = process.env.ANT_API_KEY;

    if (!apiKey) {
      console.warn('⚠️  ANT_API_KEY not found. Falling back to mock AI theme generation.');
      this.anthropic = undefined;
    } else {
      this.anthropic = new Anthropic({ apiKey });
      console.log('✅ Claude AI initialized for theme generation');
    }
  }

  async generateTheme(tenantId: string, dto: GenerateThemeDto): Promise<any> {
    // If Anthropic is not configured, gracefully fall back to mock theme generation
    if (!this.anthropic) {
      console.warn('⚠️  Anthropic client not initialized. Using mock theme generator instead.');
      return this.generateMockTheme(tenantId, dto);
    }

    try {
      const systemPrompt = this.getSystemPrompt();
      const userPrompt = this.buildPrompt(dto);

      const completion = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        temperature: 0.9,
        messages: [
          {
            role: 'user',
            content: `${systemPrompt}\n\n${userPrompt}\n\nRespond with ONLY valid JSON, no additional text.`
          }
        ],
      });

      const responseContent = completion.content[0].type === 'text' 
        ? completion.content[0].text 
        : '';
      
      if (!responseContent) {
        throw new Error('No content generated from AI');
      }
      
      const themeData = JSON.parse(responseContent);

      // Save theme to database
      const theme = await this.prisma.theme.create({
        data: {
          tenantId,
          name: themeData.name,
          description: themeData.description || 'AI-generated theme',
          settings: themeData.config, // Store config in settings field
          isActive: false,
        },
      });

      return {
        success: true,
        theme,
        metadata: {
          model: completion.model,
          tokensUsed: completion.usage?.input_tokens + completion.usage?.output_tokens,
        },
      };
    } catch (error: any) {
      console.error('❌ AI Theme Generation Error:', error);
      console.log('⚠️ Falling back to mock theme generation');
      
      // Fallback to mock theme generation
      return this.generateMockTheme(tenantId, dto);
    }
  }

  private async generateMockTheme(tenantId: string, dto: GenerateThemeDto): Promise<any> {
    const themeVariants = [
      {
        name: 'Modern Professional',
        description: 'Clean and professional theme with blue accents and modern design',
        design: 'modern',
        config: {
          colors: {
            primary: '#3B82F6',
            secondary: '#8B5CF6',
            accent: '#F59E0B',
            background: '#FFFFFF',
            surface: '#F9FAFB',
            text: '#1F2937',
            textSecondary: '#6B7280',
            border: '#E5E7EB',
            success: '#10B981',
            warning: '#F59E0B',
            error: '#EF4444',
            info: '#3B82F6'
          },
          typography: {
            fontFamily: 'Inter, system-ui, sans-serif',
            headingFamily: 'Inter, system-ui, sans-serif',
            fontSize: {
              xs: '0.75rem',
              sm: '0.875rem',
              base: '1rem',
              lg: '1.125rem',
              xl: '1.25rem',
              '2xl': '1.5rem',
              '3xl': '1.875rem',
              '4xl': '2.25rem',
              '5xl': '3rem'
            },
            fontWeight: {
              normal: '400',
              medium: '500',
              semibold: '600',
              bold: '700'
            }
          },
          spacing: {
            xs: '0.25rem',
            sm: '0.5rem',
            md: '1rem',
            lg: '1.5rem',
            xl: '2rem',
            '2xl': '3rem'
          },
          borderRadius: {
            sm: '0.25rem',
            md: '0.5rem',
            lg: '0.75rem',
            xl: '1rem',
            full: '9999px'
          },
          shadows: {
            sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
            md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }
        }
      },
      {
        name: 'Dark Elegance',
        description: 'Sophisticated dark theme with purple and pink accents, elegant design',
        design: 'elegant',
        config: {
          colors: {
            primary: '#8B5CF6',
            secondary: '#EC4899',
            accent: '#F59E0B',
            background: '#0F172A',
            surface: '#1E293B',
            text: '#F1F5F9',
            textSecondary: '#94A3B8',
            border: '#334155',
            success: '#10B981',
            warning: '#F59E0B',
            error: '#EF4444',
            info: '#3B82F6'
          },
          typography: {
            fontFamily: 'Inter, system-ui, sans-serif',
            headingFamily: 'Inter, system-ui, sans-serif',
            fontSize: {
              xs: '0.75rem',
              sm: '0.875rem',
              base: '1rem',
              lg: '1.125rem',
              xl: '1.25rem',
              '2xl': '1.5rem',
              '3xl': '1.875rem',
              '4xl': '2.25rem',
              '5xl': '3rem'
            },
            fontWeight: {
              normal: '400',
              medium: '500',
              semibold: '600',
              bold: '700'
            }
          },
          spacing: {
            xs: '0.25rem',
            sm: '0.5rem',
            md: '1rem',
            lg: '1.5rem',
            xl: '2rem',
            '2xl': '3rem'
          },
          borderRadius: {
            sm: '0.5rem',
            md: '0.75rem',
            lg: '1rem',
            xl: '1.5rem',
            full: '9999px'
          },
          shadows: {
            sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
            md: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            lg: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            xl: '0 25px 30px -5px rgba(0, 0, 0, 0.2)'
          }
        }
      }
    ];

    // Select a random variant
    const selectedTheme = themeVariants[randomInt(0, themeVariants.length)];

    // Save theme to database
    const theme = await this.prisma.theme.create({
      data: {
        tenantId,
        name: selectedTheme.name,
        description: selectedTheme.description,
        settings: selectedTheme.config, // Store config in settings field
        isActive: false,
      },
    });

    return {
      success: true,
      theme,
      metadata: {
        model: 'mock-fallback',
        tokensUsed: 0,
        note: 'AI generation unavailable, using professional preset theme'
      },
    };
  }

  private buildPrompt(dto: GenerateThemeDto): string {
    return `Generate a professional e-commerce theme based on this description:

"${dto.prompt}"

${dto.style ? `Style preference: ${dto.style}` : ''}

Create a complete, production-ready theme with modern design principles.`;
  }

  private getSystemPrompt(): string {
    return `You are an expert UI/UX designer specializing in creating beautiful, professional e-commerce themes.

Your task is to generate a complete theme configuration in JSON format.

OUTPUT FORMAT (JSON):
{
  "name": "Theme Name",
  "description": "Brief description",
  "config": {
    "colors": {
      "primary": "#3B82F6",
      "secondary": "#8B5CF6",
      "accent": "#F59E0B",
      "background": "#FFFFFF",
      "surface": "#F9FAFB",
      "text": "#1F2937",
      "textSecondary": "#6B7280",
      "border": "#E5E7EB",
      "success": "#10B981",
      "warning": "#F59E0B",
      "error": "#EF4444",
      "info": "#3B82F6"
    },
    "typography": {
      "fontFamily": "Inter, system-ui, sans-serif",
      "headingFamily": "Inter, system-ui, sans-serif",
      "fontSize": {
        "xs": "0.75rem",
        "sm": "0.875rem",
        "base": "1rem",
        "lg": "1.125rem",
        "xl": "1.25rem",
        "2xl": "1.5rem",
        "3xl": "1.875rem",
        "4xl": "2.25rem",
        "5xl": "3rem"
      },
      "fontWeight": {
        "normal": "400",
        "medium": "500",
        "semibold": "600",
        "bold": "700"
      }
    },
    "spacing": {
      "xs": "0.25rem",
      "sm": "0.5rem",
      "md": "1rem",
      "lg": "1.5rem",
      "xl": "2rem",
      "2xl": "3rem"
    },
    "borderRadius": {
      "sm": "0.25rem",
      "md": "0.5rem",
      "lg": "0.75rem",
      "xl": "1rem",
      "full": "9999px"
    },
    "shadows": {
      "sm": "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
      "md": "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
      "lg": "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
      "xl": "0 20px 25px -5px rgba(0, 0, 0, 0.1)"
    }
  }
}

DESIGN PRINCIPLES:
1. Use modern, harmonious color palettes
2. Ensure WCAG AA accessibility (contrast ratios)
3. Professional typography with clear hierarchy
4. Consistent spacing system
5. Modern border radius values
6. Subtle, professional shadows

Return ONLY valid JSON with NO additional text.`;
  }
}
