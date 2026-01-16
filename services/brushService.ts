import { generateBrushMask } from './geminiService';

export const BrushAPI = {
  generateMask: async (prompt: string): Promise<string | null> => {
    console.log(`[BrushAPI] generateMask(prompt="${prompt}")`);
    return await generateBrushMask(prompt);
  },

  // Process a raw image URL into a usable Alpha Mask Canvas for the brush engine
  processMaskTip: async (src: string): Promise<HTMLCanvasElement | null> => {
    console.log(`[BrushAPI] processMaskTip()`);
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.src = src;
      img.onload = () => {
        const cvs = document.createElement('canvas'); 
        cvs.width = img.width; 
        cvs.height = img.height;
        const ctx = cvs.getContext('2d');
        if (!ctx) { resolve(null); return; }

        ctx.drawImage(img, 0, 0);
        
        // Convert to pure alpha mask (White = opaque, Black = transparent logic or Alpha channel)
        const idata = ctx.getImageData(0, 0, cvs.width, cvs.height);
        const data = idata.data;
        
        // Simple heuristic: if the image has white background, convert white to transparent
        // or if it's black/white, map brightness to alpha.
        
        // Let's assume the generated masks are White Shape on Black Background (or vice versa).
        // We want White = Solid Alpha, Black = Transparent.
        
        // Check center pixel to guess if it's inverted (optimization)
        // For now, standard processing: Luminance -> Alpha
        
        for(let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            const a = data[i+3];
            
            // Calculate luminance
            const lum = (r + g + b) / 3;
            
            // If it's a typical "black shape on white", we invert. 
            // But usually brushes are "white shape on black".
            // Let's assume White = Ink.
            
            data[i] = 255;     // R (White)
            data[i+1] = 255;   // G
            data[i+2] = 255;   // B
            data[i+3] = lum * (a / 255); // Alpha based on brightness
        }
        
        ctx.putImageData(idata, 0, 0);
        resolve(cvs);
      };
      img.onerror = () => {
        console.warn(`[BrushAPI] Failed to load mask image.`);
        resolve(null);
      };
    });
  }
};