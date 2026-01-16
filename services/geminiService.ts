
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const summarizePassage = async (text: string) => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Summarize this text concisely for someone who is speed reading it. Focus on key plot points or main arguments: \n\n${text.substring(0, 5000)}`,
      config: {
        temperature: 0.7,
        maxOutputTokens: 250,
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Summarization Error:", error);
    return "Could not generate summary at this time.";
  }
};

export const explainWord = async (word: string, context: string) => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Briefly define the word "${word}" in the following context: \n\n"${context}"`,
      config: {
        temperature: 0.5,
        maxOutputTokens: 100,
      }
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Explanation Error:", error);
    return "Could not explain word.";
  }
};
