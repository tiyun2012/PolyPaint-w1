import React, { useState } from 'react';
import { Layer } from '../types';
import { IconLayer, IconEye, IconEyeOff, IconTrash, IconPlus, IconSparkles, IconChevronUp, IconChevronDown } from './Icons';
import { generateTexture } from '../services/geminiService';
import { eventBus, Events } from '../services/eventBus';

interface LayerManagerProps {
  layers: Layer[];
  activeLayerId: string;
  onSelectLayer: (id: string) => void;
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onUpdateLayerTexture: (id: string, imageSrc: string) => void;
  onReorderLayer: (id: string, direction: 'up' | 'down') => void;
  onRenameLayer: (id: string, newName: string) => void;
}

const LayerManager: React.FC<LayerManagerProps> = ({
  layers,
  activeLayerId,
  onSelectLayer,
  onAddLayer,
  onRemoveLayer,
  onToggleVisibility,
  onUpdateLayerTexture,
  onReorderLayer,
  onRenameLayer
}) => {
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  
  // Renaming State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');

  const handleGenerate = async () => {
    if (!aiPrompt) return;
    setIsGenerating(true);
    try {
      const textureData = await generateTexture(aiPrompt);
      if (textureData) {
        onUpdateLayerTexture(activeLayerId, textureData);
        // Explicitly refresh composite after async texture update
        eventBus.emit(Events.REFRESH_COMPOSITE);
        setShowAiModal(false);
        setAiPrompt('');
      }
    } catch (e) {
      alert("Failed to generate texture. Check console or API Key.");
    } finally {
      setIsGenerating(false);
    }
  };

  const startEditing = (layer: Layer) => {
    setEditingId(layer.id);
    setTempName(layer.name);
  };

  const saveEditing = () => {
    if (editingId && tempName.trim()) {
      onRenameLayer(editingId, tempName.trim());
    }
    setEditingId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveEditing();
    if (e.key === 'Escape') setEditingId(null);
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border-l border-neutral-700 w-72 text-sm">
      <div className="p-3 border-b border-neutral-700 font-bold flex justify-between items-center text-neutral-200">
        <div className="flex items-center gap-2">
          <IconLayer className="w-4 h-4" />
          Layers
        </div>
        <button 
          onClick={onAddLayer}
          className="p-1 hover:bg-neutral-700 rounded transition-colors text-green-400"
          title="Add Layer"
        >
          <IconPlus className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* Render reversed so top layer is at top of list */}
        {[...layers].reverse().map((layer, reverseIndex) => {
          // Calculate actual index in the source 'layers' array
          // layers = [0, 1, 2] -> rendered [2, 1, 0]
          // index 2 is top.
          const actualIndex = layers.length - 1 - reverseIndex;
          const isTop = actualIndex === layers.length - 1;
          const isBottom = actualIndex === 0;

          return (
            <div
              key={layer.id}
              onClick={() => onSelectLayer(layer.id)}
              className={`
                flex items-center gap-2 p-2 rounded cursor-pointer transition-all border group
                ${activeLayerId === layer.id 
                  ? 'bg-neutral-800 border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.1)]' 
                  : 'bg-transparent border-transparent hover:bg-neutral-800'}
              `}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(layer.id);
                }}
                className={`p-1 rounded hover:bg-neutral-600 ${layer.visible ? 'text-neutral-400' : 'text-neutral-600'}`}
              >
                {layer.visible ? <IconEye className="w-4 h-4" /> : <IconEyeOff className="w-4 h-4" />}
              </button>

              <div className="flex-1 min-w-0">
                {editingId === layer.id ? (
                  <input 
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onBlur={saveEditing}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    className="w-full bg-neutral-900 border border-blue-500 rounded px-1 py-0.5 text-white focus:outline-none"
                  />
                ) : (
                  <div 
                    onDoubleClick={(e) => {
                       e.stopPropagation();
                       startEditing(layer);
                    }}
                    className="truncate select-none text-neutral-300 w-full"
                    title="Double click to rename"
                  >
                    {layer.name}
                  </div>
                )}
              </div>
              
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                 <button
                   onClick={(e) => { e.stopPropagation(); onReorderLayer(layer.id, 'up'); }}
                   disabled={isTop}
                   className={`p-0.5 rounded ${isTop ? 'text-neutral-700' : 'text-neutral-500 hover:text-white hover:bg-neutral-600'}`}
                 >
                    <IconChevronUp className="w-3 h-3" />
                 </button>
                 <button
                   onClick={(e) => { e.stopPropagation(); onReorderLayer(layer.id, 'down'); }}
                   disabled={isBottom}
                   className={`p-0.5 rounded ${isBottom ? 'text-neutral-700' : 'text-neutral-500 hover:text-white hover:bg-neutral-600'}`}
                 >
                    <IconChevronDown className="w-3 h-3" />
                 </button>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveLayer(layer.id);
                }}
                className="p-1 rounded text-neutral-600 hover:text-red-400 hover:bg-neutral-700 ml-1"
                disabled={layers.length <= 1}
              >
                <IconTrash className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-neutral-700">
         <button
          onClick={() => setShowAiModal(!showAiModal)}
          className="w-full py-2 bg-gradient-to-r from-purple-600 to-indigo-600 rounded text-white font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-lg"
         >
           <IconSparkles className="w-4 h-4" />
           AI Texture Gen
         </button>
      </div>

      {showAiModal && (
        <div className="absolute bottom-16 right-72 w-72 bg-neutral-800 border border-neutral-600 rounded-lg p-4 shadow-2xl z-50">
          <h3 className="text-sm font-bold mb-2 text-neutral-200">Generate Texture (Active Layer)</h3>
          <textarea
            className="w-full bg-neutral-900 border border-neutral-600 rounded p-2 text-white text-xs mb-3 focus:outline-none focus:border-purple-500"
            rows={3}
            placeholder="e.g. rusty metal plate, green reptile skin, wooden planks..."
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button 
              onClick={() => setShowAiModal(false)}
              className="px-3 py-1 bg-neutral-700 rounded text-xs hover:bg-neutral-600"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !aiPrompt}
              className="px-3 py-1 bg-purple-600 rounded text-xs hover:bg-purple-500 disabled:opacity-50 flex items-center gap-2"
            >
              {isGenerating ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LayerManager;