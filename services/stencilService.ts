import { StencilSettings } from '../types';
import { TIP_LIBRARY } from '../constants';

export const StencilAPI = {
  getDefaults: (): StencilSettings => {
    console.log(`[StencilAPI] getDefaults()`);
    return {
      visible: false,
      image: TIP_LIBRARY[4].src, 
      opacity: 0.5,
      aspectRatio: 1,
      mode: 'edit',
      tool: 'select',
      rowCuts: [0, 1], 
      colCuts: [0, 1] 
    };
  },

  addCut: (cuts: number[], value: number): number[] => {
    console.log(`[StencilAPI] addCut(value=${value.toFixed(3)})`);
    const newCuts = [...cuts, value];
    newCuts.sort((a, b) => a - b);
    return newCuts;
  }
};