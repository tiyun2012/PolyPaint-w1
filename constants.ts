import { BrushPreset } from './types';

export const TEXTURE_SIZE = 2048;

// Simple SVG-based masks converted to Data URLs for immediate availability
const SPLATTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="black"/><circle cx="64" cy="64" r="30" fill="white"/><circle cx="30" cy="40" r="10" fill="white"/><circle cx="100" cy="90" r="12" fill="white"/><circle cx="20" cy="100" r="8" fill="white"/><circle cx="100" cy="30" r="8" fill="white"/><circle cx="50" cy="110" r="6" fill="white"/><circle cx="90" cy="60" r="5" fill="white"/></svg>`;
const GRUNGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="black"/><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.1" numOctaves="4"/></filter><rect width="128" height="128" filter="url(#n)" opacity="0.5"/><circle cx="64" cy="64" r="50" fill="white" filter="blur(10px)" opacity="0.8"/></svg>`;
const SCRATCHES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="black"/><path d="M20,20 Q64,40 100,20 M10,60 Q50,60 90,80 M30,100 Q70,90 110,110" stroke="white" stroke-width="4" fill="none" opacity="0.8"/><path d="M40,10 L50,120 M80,20 L70,110" stroke="white" stroke-width="2" fill="none" opacity="0.6"/></svg>`;
const NEBULA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="black"/><filter id="f"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -9"/></filter><circle cx="64" cy="64" r="60" fill="white" filter="url(#f)"/></svg>`;
// Colored Tip
const RAINBOW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#fff" stop-opacity="1"/><stop offset="25%" stop-color="#ff0" stop-opacity="1"/><stop offset="50%" stop-color="#f0f" stop-opacity="1"/><stop offset="75%" stop-color="#0ff" stop-opacity="1"/><stop offset="100%" stop-color="#000" stop-opacity="0"/></radialGradient></defs><circle cx="64" cy="64" r="64" fill="url(#g)"/></svg>`;

const toBase64 = (str: string) => `data:image/svg+xml;base64,${btoa(str)}`;

const BRUSH_MASKS = {
  SPLATTER: toBase64(SPLATTER_SVG),
  GRUNGE: toBase64(GRUNGE_SVG),
  SCRATCHES: toBase64(SCRATCHES_SVG),
  NEBULA: toBase64(NEBULA_SVG),
  RAINBOW: toBase64(RAINBOW_SVG)
};

export const TIP_LIBRARY = [
    { name: 'None (Default)', src: null },
    { name: 'Ink Splatter', src: BRUSH_MASKS.SPLATTER },
    { name: 'Heavy Grunge', src: BRUSH_MASKS.GRUNGE },
    { name: 'Scratches', src: BRUSH_MASKS.SCRATCHES },
    { name: 'Nebula', src: BRUSH_MASKS.NEBULA },
    { name: 'Rainbow (Color)', src: BRUSH_MASKS.RAINBOW }
];

export const INITIAL_BRUSH = {
  color: '#ff0055',
  size: 20,
  opacity: 1,
  hardness: 0.8,
  flow: 0.5,    
  spacing: 0.1, 
  strength: 1.0, 
  isAirbrush: false,
  usePressure: true,
  maskImage: null as string | null,
  textureMix: 0,
  mode: 'paint' as const,
  curvePreviewMode: 'stroke' as const,
  rotation: 0,
  rotationJitter: 0,
  positionJitter: 0
};

export const PRESET_COLORS = [
  '#ffffff', '#000000', '#ff0055', '#00ffaa', '#00aaff', '#ffff00', '#ffaa00', '#aa00ff'
];

export const DEFAULT_PRESETS: BrushPreset[] = [
  {
    id: 'hard-round',
    name: 'Hard Round',
    settings: {
      hardness: 1.0,
      flow: 1.0,
      opacity: 1.0,
      spacing: 0.1,
      isAirbrush: false,
      usePressure: true,
      maskImage: null,
      textureMix: 0,
      mode: 'paint',
      rotation: 0,
      rotationJitter: 0,
      positionJitter: 0
    }
  },
  {
    id: 'soft-airbrush',
    name: 'Soft Airbrush',
    settings: {
      hardness: 0,
      flow: 0.1,
      opacity: 0.5,
      spacing: 0.1,
      isAirbrush: true,
      usePressure: true,
      maskImage: null,
      textureMix: 0,
      mode: 'paint'
    }
  },
  {
    id: 'ink-splatter',
    name: 'Ink Splatter',
    settings: {
      size: 40,
      hardness: 0.5,
      flow: 1.0,
      opacity: 1.0,
      spacing: 0.25, 
      isAirbrush: false,
      usePressure: true,
      maskImage: BRUSH_MASKS.SPLATTER,
      textureMix: 0,
      mode: 'paint',
      rotation: 0,
      rotationJitter: 1.0, // High variation
      positionJitter: 0.2
    }
  },
  {
    id: 'textured-chalk',
    name: 'Textured Chalk',
    settings: {
      size: 30,
      hardness: 0.2,
      flow: 0.6,
      opacity: 0.9,
      spacing: 0.15,
      strength: 1.2,
      isAirbrush: false,
      usePressure: true,
      maskImage: BRUSH_MASKS.GRUNGE,
      textureMix: 0,
      mode: 'paint',
      rotationJitter: 0.5
    }
  },
  {
    id: 'color-nebula',
    name: 'Nebula Cloud',
    settings: {
      size: 60,
      hardness: 0.0,
      flow: 0.4,
      opacity: 0.8,
      spacing: 0.2,
      strength: 1.0,
      isAirbrush: false,
      usePressure: false,
      maskImage: BRUSH_MASKS.NEBULA,
      textureMix: 1.0,
      mode: 'paint'
    }
  },
  {
    id: 'rainbow-brush',
    name: 'Rainbow Gradient',
    settings: {
      size: 50,
      hardness: 0,
      flow: 1.0,
      opacity: 1.0,
      spacing: 0.25,
      isAirbrush: false,
      usePressure: false,
      maskImage: BRUSH_MASKS.RAINBOW,
      textureMix: 1.0, // Fully colored
      mode: 'paint'
    }
  }
];