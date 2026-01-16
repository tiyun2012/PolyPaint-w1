import { GoogleGenAI } from "@google/genai";

const getClient = () => {
  if (!process.env.API_KEY) {
    console.error("[GeminiAPI] API Key not found in process.env.API_KEY");
    return null;
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const generateTexture = async (prompt: string): Promise<string | null> => {
  console.log(`[GeminiAPI] generateTexture("${prompt}") - Requesting...`);
  const ai = getClient();
  if (!ai) return null;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `Generate a square, seamless texture pattern of: ${prompt}. High quality, detailed, texture view.`,
          },
        ],
      },
    });

    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      console.warn(`[GeminiAPI] No candidates returned.`);
      return null;
    }

    const parts = candidates[0]?.content?.parts;
    if (!parts) return null;

    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        console.log(`[GeminiAPI] Texture generated successfully.`);
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    
    return null;
  } catch (error) {
    console.error("[GeminiAPI] Error generating texture:", error);
    throw error;
  }
};

export const generateBrushMask = async (prompt: string): Promise<string | null> => {
  console.log(`[GeminiAPI] generateBrushMask("${prompt}") - Requesting...`);
  const ai = getClient();
  if (!ai) return null;

  try {
    // We specifically ask for a "brush tip alpha mask" style image.
    // White on black background usually works best for processing, or black on white.
    // We will ask for a white shape on a black background.
    const fullPrompt = `Generate a high-contrast, black and white brush tip alpha mask shape of: ${prompt}. 
    The shape should be white, centered, with a black background. 
    It should look like a digital painting brush tip (e.g. grunge, splatter, ink, charcoal).`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: fullPrompt }],
      },
    });

    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) {
      console.warn(`[GeminiAPI] No candidates returned.`);
      return null;
    }

    const parts = candidates[0]?.content?.parts;
    if (!parts) return null;

    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        console.log(`[GeminiAPI] Mask generated successfully.`);
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("[GeminiAPI] Error generating mask:", error);
    throw error;
  }
};