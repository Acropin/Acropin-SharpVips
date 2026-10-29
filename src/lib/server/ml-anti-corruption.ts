/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import type { MlInspectionResult } from '../images/types.js';

/**
 * Structural fallback used when the vision service is unavailable. It can reject
 * unreadable, undersized, or nearly blank files, but cannot identify food.
 */
async function fallbackCvInspection(
  buffer: Buffer
): Promise<MlInspectionResult> {
  const now = new Date().toISOString();
  try {
    const meta = await sharp(buffer).metadata();
    const stats = await sharp(buffer).stats();

    // Check 1: Image dimension and channel health
    if (!meta.width || !meta.height || meta.width < 100 || meta.height < 100) {
      return {
        verificationLevel: 'structural-check',
        isFood: null,
        matchesTargetDish: null,
        detectedDish: 'Corrupt / Undersized Image',
        antiCorruptionPassed: false,
        rejectionReason: 'Image dimensions are below the minimum 100 × 100 pixel requirement.',
        reasoning: 'Buffer dimensions failed basic structural checks.',
        modelUsed: 'sharp-structural-checks-v1',
        inspectedAt: now,
      };
    }

    // Check 2: Color channel variance (detect blank, solid color, or single-hue corrupt frames)
    const channelStdDevs = stats.channels.map((c) => c.stdev);
    const avgStdDev = channelStdDevs.reduce((a, b) => a + b, 0) / channelStdDevs.length;

    if (avgStdDev < 8) {
      return {
        verificationLevel: 'structural-check',
        isFood: null,
        matchesTargetDish: null,
        detectedDish: 'Blank or Solid Color Pattern',
        antiCorruptionPassed: false,
        rejectionReason: 'Image is almost entirely one color and does not pass the structural image check.',
        reasoning: `Channel standard deviation too low (${avgStdDev.toFixed(1)} < 8.0).`,
        modelUsed: 'sharp-structural-checks-v1',
        inspectedAt: now,
      };
    }

    return {
      verificationLevel: 'structural-check',
      isFood: null,
      matchesTargetDish: null,
      detectedDish: 'Not evaluated without a vision model',
      antiCorruptionPassed: true,
      reasoning: `Basic image structure passed (average channel deviation ${avgStdDev.toFixed(1)}); food, dish match, and visual quality have not been evaluated. Human review is required.`,
      modelUsed: 'sharp-structural-checks-v1',
      inspectedAt: now,
    };
  } catch (err) {
    return {
      verificationLevel: 'structural-check',
      isFood: null,
      matchesTargetDish: null,
      detectedDish: 'Unreadable Buffer',
      antiCorruptionPassed: false,
      rejectionReason: `Image buffer failed binary validation: ${err instanceof Error ? err.message : String(err)}`,
      modelUsed: 'sharp-structural-checks-v1',
      inspectedAt: now,
    };
  }
}

/**
 * Inspect food image buffer using Gemini Vision 2.5 Flash for real-time dataset anti-corruption.
 * Blocks spam, non-food images, memes, corrupt uploads, and blatant mismatches.
 */
export async function inspectFoodImageWithMl(
  imageBuffer: Buffer,
  targetDish: string,
  targetSlug?: string
): Promise<MlInspectionResult> {
  const now = new Date().toISOString();
  const apiKey = process.env.GEMINI_API_KEY;

  // Structural checks cannot verify food content; accepted uploads still require review.
  if (!apiKey?.trim()) {
    return fallbackCvInspection(imageBuffer);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });
    // Convert to a small WebP representation for ultra-fast Gemini Vision analysis
    const inspectionBuffer = await sharp(imageBuffer)
      .resize(512, 512, { fit: 'inside' })
      .webp({ quality: 80 })
      .toBuffer();

    const base64Image = inspectionBuffer.toString('base64');

    const prompt = `You are the Acropin Open-Source Food Library Anti-Corruption ML Engine.
Your critical job is to protect the public restaurant menu food image library against dataset poisoning, spam, corrupt files, memes, non-food photos, inappropriate content, or blatant mislabeling.

Proposed Target Dish Name: "${targetDish}"
Proposed Universal Slug: "${targetSlug || ''}"

Inspect the attached photo and provide your strict evaluation.
Return ONLY a valid JSON object matching this schema:
{
  "is_food": boolean,
  "matches_target_dish": boolean,
  "detected_dish": string,
  "cuisine": string,
  "quality_score": number,
  "anti_corruption_passed": boolean,
  "rejection_reason": string | null,
  "reasoning": string
}

CRITICAL RULES:
1. "is_food": MUST be true only if the image visibly depicts actual edible food, beverage, ingredient, or culinary dish. MUST be false for animals (pets), human faces/selfies, documents, screenshots, vehicles, furniture, landscapes without food, memes, icons, or gibberish.
2. "matches_target_dish": MUST be true if the food plausibly depicts the target dish or a culinary variation/portion of it. If the image is a slice of pizza but the label is "Tonkotsu Ramen", set matches_target_dish to false.
3. "quality_score": integer from 0 to 100 representing clarity, photographic lighting, focus, and suitability for high-end restaurant menus. (0-30 = blurry/corrupt, 31-60 = fair, 61-85 = good, 86-100 = studio quality).
4. "anti_corruption_passed": MUST be false if is_food is false OR matches_target_dish is false OR quality_score < 40.
5. "rejection_reason": If anti_corruption_passed is false, explain succinctly why the upload is rejected (e.g., "Detected non-food item: screenshot or device photo.", "Dish mismatch: image shows tacos, but target dish is Tonkotsu Ramen.", "Image resolution or lighting is severely degraded."). If passed, return null.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: 'image/webp',
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        abortSignal: AbortSignal.timeout(8000),
      },
    });

    const text = response.text?.trim() || '{}';
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Vision response did not contain a JSON object.');
    }
    const result = parsed as Record<string, unknown>;
    if (
      typeof result.is_food !== 'boolean' ||
      typeof result.matches_target_dish !== 'boolean' ||
      typeof result.detected_dish !== 'string' ||
      typeof result.quality_score !== 'number' ||
      !Number.isInteger(result.quality_score) ||
      result.quality_score < 0 ||
      result.quality_score > 100 ||
      typeof result.anti_corruption_passed !== 'boolean'
    ) {
      throw new Error('Vision response did not match the required inspection schema.');
    }

    const isFood = result.is_food;
    const matchesTargetDish = result.matches_target_dish;
    const qualityScore = result.quality_score;
    const antiCorruptionPassed =
      result.anti_corruption_passed && isFood && matchesTargetDish && qualityScore >= 40;

    return {
      verificationLevel: 'vision-model',
      isFood,
      matchesTargetDish,
      detectedDish: result.detected_dish.trim() || 'Unidentified food',
      cuisine: typeof result.cuisine === 'string' ? result.cuisine : undefined,
      qualityScore,
      antiCorruptionPassed,
      rejectionReason: typeof result.rejection_reason === 'string'
        ? result.rejection_reason
        : (antiCorruptionPassed ? undefined : 'Vision checks did not pass the food, dish match, or quality requirements.'),
      reasoning: typeof result.reasoning === 'string' ? result.reasoning : '',
      modelUsed: response.modelVersion || 'gemini-3.8-flash',
      inspectedAt: now,
    };
  } catch (apiError) {
    console.warn('Vision inspection unavailable; falling back to structural image checks:', apiError);
    return fallbackCvInspection(imageBuffer);
  }
}
