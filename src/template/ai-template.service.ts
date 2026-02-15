import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { GenerateTemplateDto } from './dto/ai-template.dto';

@Injectable()
export class AiTemplateService {
  private readonly logger = new Logger(AiTemplateService.name);
  private anthropic!: Anthropic;

  constructor() {
    const apiKey = process.env.ANT_API_KEY;
    
    if (!apiKey) {
      this.logger.warn('⚠️  ANT_API_KEY not found. AI template generation will not work.');
    } else {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('✅ Claude AI initialized for AI template generation');
    }
  }

  /**
   * Generate a page template based on user's vision using AI
   */
  async generateTemplate(dto: GenerateTemplateDto): Promise<any> {
    if (!this.anthropic) {
      throw new BadRequestException('AI service is not configured. Please add ANT_API_KEY to environment variables.');
    }

    try {
      const prompt = this.buildPrompt(dto);
      
      let completion;
      try {
        completion = await this.anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4096,
          temperature: 0.8,
          messages: [
            {
              role: 'user',
              content: `${this.getSystemPrompt()}\n\n${prompt}\n\nPlease respond with ONLY valid JSON, no additional text.`
            }
          ],
        });
      } catch (err: any) {
        // Fallback to a different Claude model if needed
        if (err.status === 404 || err.code === 'model_not_found') {
          console.warn('⚠️ Claude 3.5 Sonnet not found, falling back to Claude 3 Sonnet');
          completion = await this.anthropic.messages.create({
            model: 'claude-3-sonnet-20240229',
            max_tokens: 4096,
            temperature: 0.8,
            messages: [
              {
                role: 'user',
                content: `${this.getSystemPrompt()}\n\n${prompt}\n\nPlease respond with ONLY valid JSON, no additional text.`
              }
            ],
          });
        } else if (err.status === 429 || err.code === 'insufficient_quota') {
          console.warn('⚠️ Claude quota exceeded, returning mock templates');
          return this.getMockTemplates(dto);
        } else {
          throw err;
        }
      }

      // Extract text content from Claude's response
      const responseContent = completion.content[0].type === 'text' 
        ? completion.content[0].text 
        : '';
      
      if (!responseContent) {
        throw new Error('No content generated from AI');
      }
      
      const generatedTemplate = JSON.parse(responseContent);

      return {
        success: true,
        template: generatedTemplate,
        metadata: {
          model: completion.model,
          tokensUsed: completion.usage?.input_tokens + completion.usage?.output_tokens,
          vision: dto.vision,
        },
      };
    } catch (error: any) {
      console.error('❌ AI Template Generation Error:', error);
      
      // Fallback to mock templates
      console.log('⚠️ Falling back to mock templates due to error');
      return this.getMockTemplates(dto);
    }
  }

  private getMockTemplates(dto: GenerateTemplateDto) {
    return {
      success: true,
      template: {
        name: `${dto.businessType || 'Modern'} Template`,
        description: `A professional template for ${dto.businessType || 'your business'}`,
        category: dto.category || 'custom',
        thumbnail: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=500&q=80',
        content: [
          {
            id: 'header',
            type: 'header',
            data: {
              logo: dto.businessType || 'Store',
              links: [
                { label: 'Home', url: '/' },
                { label: 'Products', url: '/products' },
                { label: 'About', url: '/about' },
                { label: 'Contact', url: '/contact' }
              ]
            },
            styles: {
              backgroundColor: '#ffffff',
              textColor: '#333333',
              padding: '20px'
            }
          },
          {
            id: 'hero',
            type: 'hero',
            data: {
              title: `Welcome to ${dto.businessType || 'Our Store'}`,
              subtitle: dto.vision.substring(0, 100) + '...',
              ctaText: 'Shop Now',
              ctaLink: '/products',
              backgroundImage: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&q=80'
            },
            styles: {
              backgroundColor: '#1a1a1a',
              textColor: '#ffffff',
              padding: '100px 20px',
              alignment: 'center'
            }
          },
          {
            id: 'features',
            type: 'features',
            data: {
              items: [
                { title: 'Premium Quality', description: 'Best products in the market', icon: 'star' },
                { title: 'Fast Delivery', description: 'Instant digital delivery', icon: 'zap' },
                { title: '24/7 Support', description: 'Always here to help', icon: 'message-circle' }
              ]
            },
            styles: {
              backgroundColor: '#ffffff',
              textColor: '#333333',
              padding: '60px 20px'
            }
          },
          {
            id: 'products',
            type: 'products-grid',
            data: {
              title: 'Featured Products',
              count: 4
            },
            styles: {
              backgroundColor: '#f9f9f9',
              padding: '80px 20px'
            }
          },
          {
            id: 'testimonials',
            type: 'testimonials',
            data: {
              items: [
                { name: 'John Doe', role: 'Gamer', content: 'Amazing products and fast delivery!', avatar: 'https://i.pravatar.cc/150?u=1' },
                { name: 'Jane Smith', role: 'Streamer', content: 'The best store for gaming gear.', avatar: 'https://i.pravatar.cc/150?u=2' }
              ]
            },
            styles: {
              backgroundColor: '#ffffff',
              padding: '80px 20px'
            }
          },
          {
            id: 'newsletter',
            type: 'newsletter',
            data: {
              title: 'Subscribe to our Newsletter',
              description: 'Get the latest updates and offers.',
              buttonText: 'Subscribe'
            },
            styles: {
              backgroundColor: '#1a1a1a',
              textColor: '#ffffff',
              padding: '60px 20px'
            }
          },
          {
            id: 'footer',
            type: 'footer',
            data: {
              copyright: `© ${new Date().getFullYear()} ${dto.businessType || 'Store'}. All rights reserved.`,
              links: [
                { label: 'Privacy Policy', url: '/privacy' },
                { label: 'Terms of Service', url: '/terms' }
              ]
            },
            styles: {
              backgroundColor: '#000000',
              textColor: '#ffffff',
              padding: '40px 20px'
            }
          }
        ]
      },
      metadata: {
        model: 'mock-fallback',
        tokensUsed: 0,
        vision: dto.vision,
      },
    };
  }

  /**
   * Build the user prompt based on their input
   */
  private buildPrompt(dto: GenerateTemplateDto): string {
    let prompt = `Generate a professional website page template based on this vision:\n\n"${dto.vision}"\n\n`;

    if (dto.category) {
      prompt += `Page Category: ${dto.category}\n`;
    }

    if (dto.businessType) {
      prompt += `Business Type: ${dto.businessType}\n`;
    }

    if (dto.colorScheme) {
      prompt += `Color Scheme: ${dto.colorScheme}\n`;
    }

    if (dto.style) {
      prompt += `Design Style: ${dto.style}\n`;
    }

    prompt += `\nPlease create a complete, production-ready page template with multiple sections that brings this vision to life.`;

    return prompt;
  }

  private getSystemPrompt(): string {
    return `You are an elite web designer and developer specializing in creating stunning, professional website templates that convert visitors into customers.

Your task is to generate a complete, production-ready page template in JSON format for a page builder system.

DESIGN PRINCIPLES - CRITICAL:
1. **Premium Visual Hierarchy**: Use sophisticated spacing, clear focal points, and strategic white space
2. **Professional Color Schemes**: 
   - Use modern, harmonious color palettes (avoid basic red/blue/green)
   - Implement gradients and subtle color transitions
   - Ensure high contrast for readability (WCAG AA compliant)
   - Use colors strategically to guide user attention
3. **Typography Excellence**:
   - Use modern, professional font combinations
   - Implement clear heading hierarchy (H1: 48-64px, H2: 36-48px, H3: 24-32px)
   - Ensure readable body text (16-18px minimum)
   - Use appropriate line-height (1.5-1.8 for body text)
4. **Modern Aesthetics**:
   - Implement subtle shadows and depth
   - Use rounded corners (8-16px) for modern feel
   - Add smooth transitions and micro-interactions
   - Include glassmorphism or neumorphism where appropriate
5. **Responsive & Mobile-First**: Design with mobile users in mind
6. **Conversion-Focused**: Every section should have a clear purpose and call-to-action

REQUIRED STRUCTURE:
The template MUST include these sections in order:
1. **Header** (Navigation) - Sticky, professional, with clear branding
2. **Hero** - Stunning, attention-grabbing with compelling CTA
3. **Features/Benefits** - 3-6 key features with icons and descriptions
4. **Products/Services Grid** - Showcase offerings professionally
5. **Social Proof** - Testimonials or stats to build trust
6. **Newsletter/CTA** - Capture leads or drive action
7. **Footer** - Comprehensive with links and contact info

OUTPUT FORMAT (JSON):
{
  "name": "Professional Template Name",
  "description": "Compelling description highlighting the template's strengths",
  "category": "landing|about|contact|product|service|portfolio|blog|custom",
  "thumbnail": "https://images.unsplash.com/photo-[relevant-id]?w=800&q=80",
  "content": [
    {
      "id": "unique-section-id",
      "type": "header|hero|features|products|products-grid|testimonials|pricing|contact|faq|newsletter|footer|cta|stats|team",
      "data": {
        // Section-specific data with PROFESSIONAL content
        // For hero: { title: "Compelling Headline", subtitle: "Clear value proposition", ctaText: "Action-Oriented CTA", ctaLink: "/path", backgroundImage: "high-quality-url" }
        // For features: { title: "Section Heading", items: [{ title: "Feature Name", description: "Clear benefit", icon: "emoji or icon name" }] }
        // For testimonials: { title: "What Our Customers Say", items: [{ name: "Full Name", role: "Job Title", company: "Company Name", content: "Specific, credible testimonial", avatar: "url", rating: 5 }] }
        // For products-grid: { title: "Featured Products", limit: 8, layout: "grid", columns: 4 }
        // For stats: { title: "Our Impact", items: [{ value: "1000+", label: "Happy Customers", icon: "emoji" }] }
        // For newsletter: { title: "Stay Updated", subtitle: "Get exclusive offers", placeholder: "Enter your email", buttonText: "Subscribe" }
        // For footer: { companyName: "Brand Name", links: [{ label: "Link", url: "/path" }], socialLinks: { facebook: "", twitter: "", instagram: "" } }
      },
      "styles": {
        "backgroundColor": "#FFFFFF or gradient(to-br, #color1, #color2)",
        "textColor": "#1F2937 (dark gray for readability)",
        "padding": "80px 20px (generous spacing)",
        "alignment": "center|left|right",
        "minHeight": "500px (for hero sections)",
        "borderRadius": "16px (for cards)",
        "boxShadow": "0 10px 40px rgba(0,0,0,0.1) (subtle depth)"
      }
    }
  ]
}

CONTENT GUIDELINES - MUST FOLLOW:
✓ Use high-quality Unsplash images (search for relevant terms)
✓ Write compelling, benefit-focused copy (not generic lorem ipsum)
✓ Include 6-8 sections minimum for completeness
✓ Use modern color palettes:
  - Tech/SaaS: Blues (#3B82F6), Purples (#8B5CF6), Gradients
  - E-commerce: Bold colors with high contrast
  - Professional: Navy (#1E40AF), Emerald (#059669), Gold accents
  - Creative: Vibrant gradients, playful colors
✓ Implement visual hierarchy with size, color, and spacing
✓ Add specific, measurable stats (e.g., "10,000+ Happy Customers")
✓ Include clear, action-oriented CTAs ("Get Started Free", "Shop Now", "Book a Demo")
✓ Use professional icons/emojis: ⭐ 🚀 💎 ✨ 🎯 💼 📈 🔒 ⚡ 🎁

DESIGN PATTERNS TO USE:
- Hero: Full-width with gradient overlay, large heading, clear CTA
- Features: Grid layout with icons, concise titles, benefit-focused descriptions
- Testimonials: Cards with photos, names, roles, and ratings
- Stats: Large numbers with labels, arranged in a grid
- Newsletter: Centered, with email input and prominent button
- Footer: Multi-column with organized links and social icons

Return ONLY valid JSON with NO additional text, explanations, or markdown formatting.`;
  }

  /**
   * Generate multiple template variations
   */
  async generateVariations(
    dto: GenerateTemplateDto,
    count: number = 3
  ): Promise<any[]> {
    const variations: any[] = [];

    for (let i = 0; i < count; i++) {
      const variation = await this.generateTemplate({
        ...dto,
        vision: `${dto.vision} (Variation ${i + 1}: ${this.getVariationStyle(i)})`,
      });
      variations.push(variation);
    }

    return variations;
  }

  /**
   * Get different style variations
   */
  private getVariationStyle(index: number): string {
    const styles = [
      'modern and minimalist',
      'bold and vibrant',
      'elegant and professional',
      'creative and unique',
      'clean and corporate',
    ];
    return styles[index % styles.length];
  }

  /**
   * Refine an existing template based on feedback
   */
  async refineTemplate(
    existingTemplate: any,
    feedback: string
  ): Promise<any> {
    if (!this.anthropic) {
      throw new BadRequestException('AI service is not configured.');
    }

    try {
      let completion;
      try {
        completion = await this.anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4096,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: `${this.getSystemPrompt()}\n\nHere is an existing template:\n\n${JSON.stringify(existingTemplate, null, 2)}\n\nUser feedback: "${feedback}"\n\nPlease refine the template based on this feedback while maintaining the overall structure. Respond with ONLY valid JSON, no additional text.`
            }
          ],
        });
      } catch (err: any) {
        if (err.status === 404 || err.code === 'model_not_found') {
          console.warn('⚠️ Claude 3.5 Sonnet not found, falling back to Claude 3 Sonnet');
          completion = await this.anthropic.messages.create({
            model: 'claude-3-sonnet-20240229',
            max_tokens: 4096,
            temperature: 0.7,
            messages: [
              {
                role: 'user',
                content: `${this.getSystemPrompt()}\n\nHere is an existing template:\n\n${JSON.stringify(existingTemplate, null, 2)}\n\nUser feedback: "${feedback}"\n\nPlease refine the template based on this feedback while maintaining the overall structure. Respond with ONLY valid JSON, no additional text.`
              }
            ],
          });
        } else if (err.status === 429 || err.code === 'insufficient_quota') {
          console.warn('⚠️ Claude quota exceeded, returning original template');
          return {
            success: true,
            template: existingTemplate,
            metadata: {
              model: 'mock-fallback',
              tokensUsed: 0,
              feedback,
              warning: 'Quota exceeded, template not refined'
            }
          };
        } else {
          throw err;
        }
      }

      const content = completion.content[0].type === 'text' 
        ? completion.content[0].text 
        : '';
      if (!content) {
        throw new Error('No content generated from AI');
      }
      const refinedTemplate = JSON.parse(content);

      return {
        success: true,
        template: refinedTemplate,
        metadata: {
          model: completion.model,
          tokensUsed: completion.usage?.input_tokens + completion.usage?.output_tokens,
          feedback,
        },
      };
    } catch (error: any) {
      console.error('❌ Template Refinement Error:', error);
      // Return original template on error
      return {
        success: false,
        template: existingTemplate,
        error: error.message
      };
    }
  }
}
