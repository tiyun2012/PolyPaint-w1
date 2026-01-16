export interface BrushSettings {
  color: string;
  size: number;
  opacity: number;
  hardness: number;
  flow: number;    // Opacity per stamp
  spacing: number; // Distance between stamps (as ratio of brush size)
  strength: number; // Intensity multiplier/curve for the brush alpha
  isAirbrush: boolean; // Toggle for Airbrush mode
  maskImage: string | null; // Base64 data URL for the brush tip shape
  textureMix: number; // 0 = Use Brush Color (Tint), 1 = Use Texture Color
  mode: 'paint' | 'erase';
  rotation: number;       // Base rotation in degrees
  rotationJitter: number; // Random rotation variation (0-1)
  positionJitter: number; // Random position scattering (0-1 relative to size)
}

export interface BrushPreset {
  id: string;
  name: string;
  settings: Partial<BrushSettings>;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  canvas: HTMLCanvasElement; // Offscreen canvas for this layer
  ctx: CanvasRenderingContext2D;
}

export interface StencilSettings {
  visible: boolean;
  image: string | null; // The texture to project
  opacity: number;
  aspectRatio: number;
  mode: 'edit' | 'paint'; // 'edit' = Adjust Gizmo, 'paint' = Paint/Project (Gizmo locked)
  tool: 'select' | 'loop'; // 'select' = Move points/mesh, 'loop' = Add subdivisions
  rowCuts: number[]; // Ordered normalized values (0..1) defining horizontal cuts
  colCuts: number[]; // Ordered normalized values (0..1) defining vertical cuts
}

export interface HistoryState {
  // Simplified history for undo/redo could go here, 
  // but for now we focus on layers and painting.
}