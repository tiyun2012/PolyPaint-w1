import { v4 as uuidv4 } from 'uuid';
import { Layer } from '../types';
import { TEXTURE_SIZE } from '../constants';

export const LayerAPI = {
  create: (name: string): Layer => {
    console.log(`[LayerAPI] create('${name}')`);
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    
    return {
      id: uuidv4(),
      name,
      visible: true,
      opacity: 1,
      canvas,
      ctx
    };
  },

  fill: (layer: Layer, color: string) => {
    console.log(`[LayerAPI] fill(layer=${layer.name}, color=${color})`);
    layer.ctx.save();
    layer.ctx.globalCompositeOperation = 'source-over';
    layer.ctx.fillStyle = color;
    layer.ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    layer.ctx.restore();
  },

  clear: (layer: Layer) => {
    console.log(`[LayerAPI] clear(layer=${layer.name})`);
    layer.ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  },

  drawTexture: (layer: Layer, image: HTMLImageElement | HTMLCanvasElement | ImageBitmap) => {
    console.log(`[LayerAPI] drawTexture(layer=${layer.name})`);
    layer.ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    layer.ctx.drawImage(image, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  },

  toggleVisibility: (layers: Layer[], id: string): Layer[] => {
    console.log(`[LayerAPI] toggleVisibility(id=${id})`);
    return layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l);
  },

  remove: (layers: Layer[], id: string): Layer[] => {
    console.log(`[LayerAPI] remove(id=${id})`);
    if (layers.length <= 1) return layers;
    return layers.filter(l => l.id !== id);
  },

  rename: (layers: Layer[], id: string, name: string): Layer[] => {
    console.log(`[LayerAPI] rename(id=${id}, name=${name})`);
    return layers.map(l => l.id === id ? { ...l, name } : l);
  },

  reorder: (layers: Layer[], id: string, direction: 'up' | 'down'): Layer[] => {
    console.log(`[LayerAPI] reorder(id=${id}, direction=${direction})`);
    const index = layers.findIndex(l => l.id === id);
    if (index === -1) return layers;

    const newLayers = [...layers];
    // Up means index + 1 (towards end of array/top of stack)
    if (direction === 'up' && index < layers.length - 1) {
       [newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]];
    } else if (direction === 'down' && index > 0) {
       [newLayers[index], newLayers[index - 1]] = [newLayers[index - 1], newLayers[index]];
    }
    return newLayers;
  }
};