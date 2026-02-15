import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import OpenAI from 'openai';
import { ChatMessageDto } from './dto/chat-message.dto';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private openai: OpenAI;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not found in environment variables. AI features will be disabled.');
    } else {
      this.logger.log(`OpenAI API initialized successfully (key length: ${apiKey.length})`);
    }
    
    this.openai = new OpenAI({
      apiKey: apiKey || 'dummy-key', // Use dummy key if not set to prevent crashes
    });
  }

  async chat(chatMessageDto: ChatMessageDto, tenantId?: string): Promise<{ response: string }> {
    try {
      const { message, context } = chatMessageDto;
      const isArabic = /[\u0600-\u06FF]/.test(message);

      // Fetch training scripts
      let globalScript = '';
      let partnerScript = '';

      // 1. Get Global Admin Script
      const globalConfig = await this.prisma.platformConfig.findUnique({
        where: { key: 'GLOBAL_AI_SCRIPT' },
      });
      if (globalConfig?.value) {
        globalScript = (globalConfig.value as any).script || '';
      }

      // 2. Get Partner Script if tenant is associated with a partner
      if (tenantId) {
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { subdomain: true, name: true },
        });

        if (tenant) {
          // Try to find a partner matching the tenant's subdomain or name
          // This is a heuristic since we don't have a direct link yet
          const partner = await this.prisma.partner.findFirst({
            where: {
              OR: [
                { name: { equals: tenant.name, mode: 'insensitive' } },
                { name: { equals: tenant.subdomain, mode: 'insensitive' } },
              ],
            },
          });

          if (partner && (partner as any).aiScript) {
            partnerScript = (partner as any).aiScript;
          }
        }
      }

      // Build system message based on context and scripts
      const systemMessage = this.buildSystemMessage(context, globalScript, partnerScript);

      // Check if we have a valid API key
      if (this.openai.apiKey === 'dummy-key') {
        return { 
          response: isArabic 
            ? 'عذراً، لم يتم تكوين مفتاح API الخاص بالذكاء الاصطناعي. يرجى التواصل مع المسؤول.'
            : 'Sorry, the AI API key is not configured. Please contact the administrator.'
        };
      }

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const response = completion.choices[0]?.message?.content || 'I apologize, but I could not generate a response.';

      return { response };
    } catch (error) {
      this.logger.error('Error calling OpenAI API:', error);
      
      if (error instanceof Error) {
        if (error.message.includes('API key')) {
          throw new Error('AI service is not properly configured. Please contact support.');
        }
      }
      
      throw new Error('Failed to get AI response. Please try again.');
    }
  }

  private buildSystemMessage(
    context?: ChatMessageDto['context'], 
    globalScript?: string, 
    partnerScript?: string
  ): string {
    let systemMessage = `You are a helpful AI assistant for an e-commerce page builder platform called Saa'ah. 
Your role is to help users:
1. Understand how to use the page builder
2. Create engaging content for their pages
3. Troubleshoot issues
4. Learn about available features

Be concise, friendly, and practical. Provide actionable advice.`;

    // Append Global Admin Script
    if (globalScript) {
      systemMessage += `\n\n[SYSTEM INSTRUCTIONS]\n${globalScript}`;
    }

    // Append Partner Script
    if (partnerScript) {
      systemMessage += `\n\n[PARTNER SPECIFIC INSTRUCTIONS]\n${partnerScript}`;
    }

    if (context?.currentPage) {
      systemMessage += `\n\nThe user is currently editing a page titled: "${context.currentPage}"`;
    }

    if (context?.currentSection) {
      systemMessage += `\n\nThey are working on a "${context.currentSection}" section.`;
    }

    if (context?.userAction) {
      systemMessage += `\n\nThey are trying to: ${context.userAction}`;
    }

    return systemMessage;
  }

  async getSuggestions(sectionType: string): Promise<{ suggestions: string[] }> {
    try {
      if (this.openai.apiKey === 'dummy-key') {
        return { suggestions: [] };
      }

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a content strategist helping create engaging website content. Provide 3 brief, actionable suggestions.'
          },
          {
            role: 'user',
            content: `Give me 3 content suggestions for a "${sectionType}" section on an e-commerce website. Keep each suggestion under 15 words.`
          }
        ],
        temperature: 0.8,
        max_tokens: 200,
      });

      const response = completion.choices[0]?.message?.content || '';
      const suggestions = response
        .split('\n')
        .filter((line: string) => line.trim().length > 0)
        .map((line: string) => line.replace(/^\d+\.\s*/, '').trim())
        .slice(0, 3);

      return { suggestions };
    } catch (error) {
      this.logger.error('Error getting suggestions:', error);
      return { suggestions: [] };
    }
  }

  async generateText(prompt: string, type: string): Promise<{ text: string }> {
    try {
      if (this.openai.apiKey === 'dummy-key') {
        return { text: 'AI configuration missing.' };
      }

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional copywriter. Write a ${type} based on the user's request. Keep it engaging and concise.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 200,
      });

      return { text: completion.choices[0]?.message?.content || '' };
    } catch (error) {
      this.logger.error('Error generating text:', error);
      return { text: '' };
    }
  }

  async generateDesign(prompt: string): Promise<{ section: any }> {
    try {
      if (this.openai.apiKey === 'dummy-key') {
        return { section: null };
      }

      const systemPrompt = `You are a UI/UX designer for a page builder. 
      Generate a JSON object representing a website section based on the user's request.
      
      The output MUST be a valid JSON object with this structure:
      {
        "type": "SECTION_TYPE",
        "props": { ...PROPS_FOR_TYPE }
      }

      Available SECTION_TYPEs and their props:
      1. "hero": { title, subtitle, buttonText, buttonLink, backgroundImage (url), textColor (hex), backgroundColor (hex) }
      2. "features": { title, items: [{ icon (emoji), title, description }] }
      3. "testimonials": { title, items: [{ name, role, rating (1-5), text, image (url) }] }
      4. "faq": { title, subtitle, items: [{ question, answer }] }
      5. "cta": { title, description, buttonText, buttonLink, backgroundColor (hex), textColor (hex) }
      6. "contact": { title, subtitle, email, phone, address, showMap (boolean) }
      7. "gallery": { title, columns (string number), images: [] }
      8. "products": { title, limit (number), columns (string number), showPrice (boolean), showAddToCart (boolean) }

      Return ONLY the JSON object. Do not include markdown formatting like \`\`\`json.`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const content = completion.choices[0]?.message?.content || '{}';
      // Clean up potential markdown code blocks
      const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
      
      const section = JSON.parse(cleanContent);
      // Ensure ID is unique
      section.id = `section-${Date.now()}`;
      
      return { section };
    } catch (error) {
      this.logger.error('Error generating design:', error);
      return { section: null };
    }
  }
  async analyzeReceipt(imageUrl: string): Promise<{ amount: number | null; debug_raw?: string }> {
    try {
      if (this.openai.apiKey === 'dummy-key') {
        this.logger.warn('AI analysis skipped: internal key missing');
        return { amount: null };
      }

      this.logger.log(`Analyzing receipt image: ${imageUrl}`);

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o', 
        messages: [
          {
            role: 'system',
            content: `You are an AI expert in extracting monetary amounts from banking receipts, payment confirmations, and transaction screenshots (mostly Saudi/MENA region).
            Your task: Find the TOTAL TRANSACTION AMOUNT from the receipt image.
            
            CRITICAL RULES:
            1. Look for field labels indicating transaction amount:
               - English: "Amount", "Total", "Total Amount", "Transaction Amount", "Payment Amount", "Charged Amount"
               - Arabic: "المبلغ", "مبلغ", "الإجمالي", "مبلغ التحويل", "المبلغ المحول", "قيمة التحويل", "مبلغ الحوالة"
            
            2. **ARABIC NUMERALS**: The image may contain Arabic-Indic numerals (٠١٢٣٤٥٦٧٨٩). 
               Convert these to Western numerals (0123456789) in your response.
               Examples: 
               - "٥,٠٠٠.٠٠ ر.س" → extract 5000.00 (not 5,000.00 with comma)
               - "١٢٣.٤٥" → extract 123.45
            
            3. **NUMBER FORMATS**: 
               - Amounts may use commas as thousands separators: "5,000.00" → 5000.00
               - Amounts may use periods/dots as decimal separators: "5000.00"
               - Remove ALL commas and keep only the numeric value with decimal point
               - If a number has BOTH comma and period (e.g. "1,234.56"), remove comma, return 1234.56
            
            4. **NEGATIVE/DEBIT AMOUNTS**: 
               - **CRITICAL**: Bank receipts often show debits with a trailing minus (e.g., "500.00-", "SAR 500.00-").
               - TREAT THESE AS POSITIVE AMOUNTS. The user is uploading a proof of transfer, so the debit from their account is the amount we want.
               - Example: "500.00-" → extract 500.00
            
            5. **CURRENCY SYMBOLS**: 
               - Ignore currency symbols: "SAR", "SR", "ر.س", "﷼", "USD", "$"
               - Focus only on the numeric value
                
            6. **SPECIFIC LAYOUTS**:
               - Alrajhi/Banks: Look for "Amount" row. If it says "SAR 500.00-", the amount is 500.00.
            
            7. **AVOID FALSE POSITIVES**:
               - IGNORE transaction IDs (usually long numbers without decimals like "1234567890")
               - IGNORE dates (e.g., "2023-10-28", "28/10/2023", "١٤٤٥/٠٣/١٥")
               - IGNORE account numbers (usually 10-16 digits, no decimals)
               - IGNORE reference numbers
               - IGNORE Reference IDs (SA...)
               - The transaction amount is usually a shorter number WITH DECIMALS (e.g., "5000.00", "١٢٣.٤٥")
            
            8. **CONTEXT CLUES**:
               - The amount is typically near labels like those in rule #1
               - It's usually formatted with 2 decimal places (e.g., .00 or .50)
               - It's often prominently displayed or highlighted
            
            9. **OUTPUT FORMAT**:
               - Return ONLY a valid JSON object: {"amount": <number>}
               - The amount must be a plain number (e.g., 5000.00, NOT "5,000.00")
               - If no amount can be confidently identified, return: {"amount": null}
            
            EXAMPLES:
            - Image shows "المبلغ: ٥,٠٠٠.٠٠ ر.س" → Return: {"amount": 5000.00}
            - Image shows "Total: 1,250.50 SAR" → Return: {"amount": 1250.50}
            - Image shows "Amount: 500.00-" → Return: {"amount": 500.00}
            - Image shows "SAR 500.00-" → Return: {"amount": 500.00}
            - Image shows only transaction ID "20231028123456" → Return: {"amount": null}`
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this receipt/transaction image and extract the total transaction amount. Follow all the rules carefully, especially for negative/trailing minus signs.' },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                  detail: 'high'
                },
              },
            ],
          },
        ],
        max_tokens: 500,
        temperature: 0.1, // Lower temperature for more consistent, factual extraction
      });

      const content = completion.choices[0]?.message?.content || '{}';
      
      // Clean markdown code blocks if present
      const cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
      
      let result: { amount: number | null | string } = { amount: null };
      
      try {
        result = JSON.parse(cleanContent);
      } catch (e) {
        this.logger.warn(`Failed to parse AI response JSON: ${cleanContent}. Attempting regex fallback.`);
        
        // Fallback: Try to find "amount": 1234 or "amount": "1,234"
        const amountMatch = cleanContent.match(/"amount"\s*:\s*"?([0-9,.\-]+)"?/);
        if (amountMatch && amountMatch[1]) {
           result = { amount: amountMatch[1] };
           this.logger.log(`Regex fallback found amount: ${result.amount}`);
        } else {
           // Fallback 2: Just look for any number that looks like an amount in the text
           // This captures 5,000.00 or 5000.00-
           const simpleNumberMatch = cleanContent.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?-?)/);
           if (simpleNumberMatch && simpleNumberMatch[0]) {
             result = { amount: simpleNumberMatch[0] };
           }
        }
      }
      
      // Validate and parse the result
      let amount: number | null = null;
      let rawAmount = result?.amount;

      if (rawAmount !== null && rawAmount !== undefined) {
        if (typeof rawAmount === 'number' && !isNaN(rawAmount)) {
           // If number is negative, convert to positive (absolute value)
           amount = Math.abs(rawAmount);
        } else if (typeof rawAmount === 'string') {
           // Try to parse string amount (remove commas, MINUS SIGNS, currency symbols)
           // Explicitly removing '-' to handle '500.00-' case
           const cleaned = rawAmount.replace(/,/g, '').replace(/[^0-9.]/g, '');
           const parsed = parseFloat(cleaned);
           if (!isNaN(parsed)) {
             amount = parsed;
           }
        }
      }

      if (amount !== null) {
        this.logger.log(`Successfully extracted amount: ${amount}`);
        return { amount, debug_raw: cleanContent };
      } else {
        this.logger.warn(`AI could not detect an amount. Raw content: ${cleanContent}`);
        return { amount: null, debug_raw: cleanContent };
      }
      
      return { amount: null, debug_raw: cleanContent };

    } catch (error) {
      this.logger.error('Error analyzing receipt:', error);
      return { amount: null };
    }
  }
}
