import React, { useState } from 'react';
import { BrushSettings, BrushPreset, StencilSettings, AxisWidgetSettings } from '../types';
import { PRESET_COLORS, DEFAULT_PRESETS, TIP_LIBRARY } from '../constants';
import { IconBrush, IconAirbrush, IconSparkles, IconTrash, IconPlus, IconGrid, IconTarget, IconEraser, IconBucket, IconEye } from './Icons';
import { BrushAPI } from '../services/brushService';
import { eventBus, Events } from '../services/eventBus';

const genId = () => Math.random().toString(36).substr(2, 9);

interface ToolbarProps {
  brush: BrushSettings;
  setBrush: (b: BrushSettings) => void;
  stencil: StencilSettings;
  setStencil: (s: StencilSettings) => void;
  axisWidget: AxisWidgetSettings;
  setAxisWidget: (a: AxisWidgetSettings) => void;
  onFillLayer: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({ brush, setBrush, stencil, setStencil, axisWidget, setAxisWidget, onFillLayer }) => {
  const [activeTab, setActiveTab] = useState<'brush' | 'stencil' | 'view'>('brush');
  const [presets, setPresets] = useState<BrushPreset[]>(DEFAULT_PRESETS);
  const [isGeneratingMask, setIsGeneratingMask] = useState(false);
  const [showMaskModal, setShowMaskModal] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [maskPrompt, setMaskPrompt] = useState('');

  const handleChange = (key: keyof BrushSettings, value: any) => {
    setBrush({ ...brush, [key]: value });
  };

  const handleStencilChange = (key: keyof StencilSettings, value: any) => {
    setStencil({ ...stencil, [key]: value });
  };

  const handleApplyPreset = (preset: BrushPreset) => {
    setBrush({ ...brush, ...preset.settings });
  };

  const handleSavePreset = () => {
    const name = prompt("Enter preset name:", "My Brush");
    if (name) {
      const newPreset: BrushPreset = {
        id: genId(),
        name,
        settings: { ...brush } // Save current state
      };
      setPresets([...presets, newPreset]);
    }
  };

  const handleDeletePreset = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPresets(presets.filter(p => p.id !== id));
  };

  const handleGenerateMask = async () => {
    if (!maskPrompt) return;
    setIsGeneratingMask(true);
    try {
      const maskData = await BrushAPI.generateMask(maskPrompt);
      if (maskData) {
        handleChange('maskImage', maskData);
        setShowMaskModal(false);
        setMaskPrompt('');
      }
    } catch (e) {
      alert("Failed to generate mask.");
    } finally {
      setIsGeneratingMask(false);
    }
  };

  const handleSelectTip = (src: string | null) => {
    handleChange('maskImage', src);
    setShowLibraryModal(false);
  };

  const handleUploadTip = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          handleChange('maskImage', event.target.result);
          setShowLibraryModal(false);
        }
      };
      reader.readAsDataURL(file);
    }
  };
  
  const handleUploadStencil = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
           const img = new Image();
           img.onload = () => {
              setStencil({ 
                ...stencil, 
                image: event.target!.result as string,
                aspectRatio: img.width / img.height,
                visible: true
              });
           };
           img.src = event.target!.result as string;
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProjectStencil = () => {
      eventBus.emit(Events.CMD_PROJECT_STENCIL);
  };

  const renderBrushTab = () => (
    <>
      {/* Presets Section */}
      <div className="space-y-2">
         <div className="flex justify-between items-center text-xs text-neutral-500 font-semibold uppercase tracking-wider">
            <span>Library</span>
            <button onClick={handleSavePreset} className="text-blue-400 hover:text-blue-300" title="Save current brush as preset">
               <IconPlus className="w-4 h-4" />
            </button>
         </div>
         <div className="grid grid-cols-3 gap-2">
            {presets.map(preset => (
               <div key={preset.id} className="relative group">
                  <button
                    onClick={() => handleApplyPreset(preset)}
                    className="w-full aspect-square bg-neutral-800 border border-neutral-700 rounded-lg hover:border-blue-500 hover:bg-neutral-700 flex flex-col items-center justify-center p-1 transition-all overflow-hidden"
                    title={preset.name}
                  >
                    {preset.settings.maskImage ? (
                      <div className="w-8 h-8 mb-1 opacity-80 invert">
                         <img src={preset.settings.maskImage} alt="tip" className="w-full h-full object-contain" />
                      </div>
                    ) : (
                      preset.settings.isAirbrush ? 
                        <IconAirbrush className="w-6 h-6 text-blue-400 mb-1" /> : 
                        <IconBrush className="w-6 h-6 text-neutral-400 mb-1" />
                    )}
                    <span className="text-[9px] truncate w-full text-center text-neutral-400 leading-tight">{preset.name}</span>
                  </button>
                  {!DEFAULT_PRESETS.some(dp => dp.id === preset.id) && (
                    <button 
                      onClick={(e) => handleDeletePreset(e, preset.id)}
                      className="absolute -top-1 -right-1 bg-red-900 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    >
                      <IconTrash className="w-2 h-2" />
                    </button>
                  )}
               </div>
            ))}
         </div>
      </div>

      <hr className="border-neutral-800" />

      {/* TOOLS: Paint, Erase, Fill */}
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wider text-neutral-500 font-semibold">Tools</label>
        <div className="flex bg-neutral-800 p-1 rounded-lg border border-neutral-700 gap-1">
          <button
            onClick={() => handleChange('mode', 'paint')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded text-[10px] font-medium transition-colors ${brush.mode === 'paint' ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700'}`}
          >
            <IconBrush className="w-4 h-4" />
            Paint
          </button>
          <button
            onClick={() => handleChange('mode', 'erase')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded text-[10px] font-medium transition-colors ${brush.mode === 'erase' ? 'bg-red-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700'}`}
          >
            <IconEraser className="w-4 h-4" />
            Eraser
          </button>
          <button
            onClick={onFillLayer}
            className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 rounded text-[10px] font-medium transition-colors text-neutral-400 hover:text-white hover:bg-neutral-700`}
          >
            <IconBucket className="w-4 h-4" />
            Fill
          </button>
        </div>
      </div>

      {/* Brush Mode */}
      <div className="flex bg-neutral-800 p-1 rounded-lg border border-neutral-700">
        <button
          onClick={() => handleChange('isAirbrush', false)}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-xs font-medium transition-colors ${!brush.isAirbrush ? 'bg-neutral-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}
        >
          <IconBrush className="w-4 h-4" />
          Std
        </button>
        <button
          onClick={() => handleChange('isAirbrush', true)}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-xs font-medium transition-colors ${brush.isAirbrush ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}
        >
          <IconAirbrush className="w-4 h-4" />
          Air
        </button>
      </div>

      {/* Brush Mask/Tip */}
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wider text-neutral-500 font-semibold flex justify-between">
          Brush Tip (Mask)
          {brush.maskImage && (
             <button onClick={() => handleChange('maskImage', null)} className="text-xs text-red-400 hover:text-red-300">Clear</button>
          )}
        </label>
        <div className="flex gap-2">
           <div 
             onClick={() => setShowLibraryModal(true)}
             className="w-12 h-12 bg-black border border-neutral-600 rounded overflow-hidden flex items-center justify-center cursor-pointer hover:border-blue-500 transition-colors"
             title="Current tip - Click to change"
           >
              {brush.maskImage ? (
                <img src={brush.maskImage} alt="mask" className="w-full h-full object-cover" />
              ) : (
                <div className="w-4 h-4 rounded-full bg-white opacity-20"></div>
              )}
           </div>
           
           <div className="flex-1 flex flex-col gap-1">
             <button 
               onClick={() => setShowLibraryModal(true)}
               className="flex-1 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-xs flex items-center justify-center gap-2 text-neutral-300 transition-colors"
             >
               <IconGrid className="w-3 h-3 text-neutral-400" />
               Browse
             </button>
             <button 
               onClick={() => setShowMaskModal(true)}
               className="flex-1 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-xs flex items-center justify-center gap-2 text-neutral-300 transition-colors"
             >
               <IconSparkles className="w-3 h-3 text-purple-400" />
               Generate
             </button>
           </div>
        </div>
      </div>

      {/* Basic Settings */}
      <div className="space-y-4">
        {/* Color */}
        <div className="space-y-1">
          <div className="flex gap-2 flex-wrap">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                className={`w-5 h-5 rounded-full border border-neutral-600 ${brush.color === c ? 'ring-2 ring-white scale-110' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => handleChange('color', c)}
              />
            ))}
            <input
              type="color"
              value={brush.color}
              onChange={(e) => handleChange('color', e.target.value)}
              className="w-5 h-5 rounded-full overflow-hidden border-none p-0 bg-transparent cursor-pointer"
            />
          </div>
        </div>
        
        {/* Texture Mix */}
        {brush.maskImage && (
          <div className="space-y-1 bg-neutral-800 p-2 rounded border border-neutral-700">
             <div className="flex justify-between text-xs text-neutral-300 font-medium">
               <span>Texture Color Mix</span>
               <span>{Math.round(brush.textureMix * 100)}%</span>
             </div>
             <input
               type="range"
               min="0"
               max="1"
               step="0.01"
               value={brush.textureMix}
               onChange={(e) => handleChange('textureMix', parseFloat(e.target.value))}
               className="w-full h-1 bg-neutral-600 rounded-lg appearance-none cursor-pointer accent-yellow-500"
             />
          </div>
        )}

        {/* Sliders - Standard */}
        {[
          { label: 'Size', key: 'size', min: 1, max: 150, step: 1, val: brush.size, color: 'accent-blue-500' },
          { label: 'Opacity', key: 'opacity', min: 0.01, max: 1, step: 0.01, val: brush.opacity, color: 'accent-blue-500' },
          { label: 'Flow', key: 'flow', min: 0.01, max: 1, step: 0.01, val: brush.flow, color: 'accent-purple-500' },
          { label: 'Strength', key: 'strength', min: 0.1, max: 2, step: 0.1, val: brush.strength, color: 'accent-red-500' },
        ].map(s => (
          <div key={s.label} className="space-y-1">
             <div className="flex justify-between text-xs text-neutral-400">
               <span>{s.label}</span>
               <span>{s.key === 'size' ? s.val + 'px' : Math.round(s.val as number * 100) + '%'}</span>
             </div>
             <input
               type="range"
               min={s.min}
               max={s.max}
               step={s.step}
               value={s.val as number}
               onChange={(e) => handleChange(s.key as keyof BrushSettings, parseFloat(e.target.value))}
               className={`w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer ${s.color}`}
             />
          </div>
        ))}
         
         {/* Hardness */}
         <div className={`space-y-1 transition-opacity ${brush.isAirbrush || brush.maskImage ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
            <div className="flex justify-between text-xs text-neutral-400">
              <span>Hardness</span>
              <span>{Math.round(brush.hardness * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={brush.hardness}
              onChange={(e) => handleChange('hardness', parseFloat(e.target.value))}
              className="w-full accent-blue-500 h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer"
            />
          </div>
          
          <hr className="border-neutral-800" />
          
          {/* Dynamics Section */}
          <label className="text-xs uppercase tracking-wider text-neutral-500 font-semibold">Dynamics</label>
          {[
              { label: 'Spacing', key: 'spacing', min: 0.01, max: 1.0, step: 0.01, val: brush.spacing, color: 'accent-green-500' },
              { label: 'Rotation', key: 'rotation', min: 0, max: 360, step: 1, val: brush.rotation, color: 'accent-yellow-500' },
              { label: 'Angle Jitter', key: 'rotationJitter', min: 0, max: 1, step: 0.01, val: brush.rotationJitter, color: 'accent-orange-500' },
              { label: 'Scatter', key: 'positionJitter', min: 0, max: 1, step: 0.01, val: brush.positionJitter, color: 'accent-pink-500' },
          ].map(s => (
            <div key={s.label} className="space-y-1">
               <div className="flex justify-between text-xs text-neutral-400">
                 <span>{s.label}</span>
                 <span>{s.key === 'rotation' ? s.val + '°' : Math.round(s.val as number * 100) + '%'}</span>
               </div>
               <input
                 type="range"
                 min={s.min}
                 max={s.max}
                 step={s.step}
                 value={s.val as number}
                 onChange={(e) => handleChange(s.key as keyof BrushSettings, parseFloat(e.target.value))}
                 className={`w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer ${s.color}`}
               />
            </div>
          ))}

      </div>
    </>
  );

  const renderStencilTab = () => (
    <div className="space-y-5">
      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wider text-neutral-500 font-semibold">Stencil Grid</label>
        <button
          onClick={() => handleStencilChange('visible', !stencil.visible)}
          className={`w-full py-2 rounded text-xs font-medium border transition-colors ${stencil.visible ? 'bg-green-600 border-green-500 text-white' : 'bg-neutral-800 border-neutral-700 text-neutral-400'}`}
        >
          {stencil.visible ? 'Visible & Active' : 'Hidden'}
        </button>
      </div>

      {stencil.visible && (
        <>
          <div className="flex bg-neutral-800 p-1 rounded-lg border border-neutral-700">
            <button
              onClick={() => handleStencilChange('mode', 'edit')}
              className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase transition-colors ${stencil.mode === 'edit' ? 'bg-yellow-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}
            >
              Edit
            </button>
            <button
              onClick={() => handleStencilChange('mode', 'paint')}
              className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase transition-colors ${stencil.mode === 'paint' ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}
            >
              Paint
            </button>
          </div>
          
          {stencil.mode === 'edit' && (
             <div className="flex bg-neutral-800 p-1 rounded-lg border border-neutral-700 mt-2">
                <button
                  onClick={() => handleStencilChange('tool', 'select')}
                  className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase transition-colors flex flex-col items-center gap-1 ${stencil.tool === 'select' ? 'bg-neutral-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  <IconTarget className="w-3 h-3" /> Select
                </button>
                <button
                  onClick={() => handleStencilChange('tool', 'loop')}
                  className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase transition-colors flex flex-col items-center gap-1 ${stencil.tool === 'loop' ? 'bg-orange-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
                >
                  <IconGrid className="w-3 h-3" /> Add Loop
                </button>
             </div>
          )}
        </>
      )}

      <div className="space-y-2">
         <label className="text-xs uppercase tracking-wider text-neutral-500 font-semibold flex justify-between">
           Projection Texture
         </label>
         <div className="aspect-square bg-neutral-800 border border-neutral-700 rounded overflow-hidden relative group">
            {stencil.image ? (
              <img src={stencil.image} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-neutral-600 text-[10px] text-center p-2">
                 No Image Selected
              </div>
            )}
            <label className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
               <span className="text-xs text-white font-medium">Change</span>
               <input type="file" className="hidden" accept="image/*" onChange={handleUploadStencil} />
            </label>
         </div>
      </div>
      
      {/* Resolution Slider Removed as requested */}

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-neutral-400">
           <span>Grid Opacity</span>
           <span>{Math.round(stencil.opacity * 100)}%</span>
        </div>
        <input
           type="range"
           min="0"
           max="1"
           step="0.01"
           value={stencil.opacity}
           onChange={(e) => handleStencilChange('opacity', parseFloat(e.target.value))}
           className="w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-green-500"
        />
      </div>

      <div className="bg-neutral-800 p-3 rounded border border-neutral-700 text-[10px] text-neutral-400 space-y-2">
        {stencil.mode === 'edit' && stencil.tool === 'select' && <p className="text-yellow-400 font-bold">Tool: Drag dots to warp. Drag grid to move.</p>}
        {stencil.mode === 'edit' && stencil.tool === 'loop' && <p className="text-orange-400 font-bold">Tool: Hover near edge lines to detect loop. Click to insert.</p>}
        {stencil.mode === 'paint' && <p className="text-blue-400 font-bold">Tool: Paint or Project is active.</p>}
      </div>

      <button
        onClick={handleProjectStencil}
        disabled={!stencil.visible || !stencil.image}
        className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 rounded text-white font-bold text-xs uppercase tracking-wide hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        Project to Layer
      </button>
    </div>
  );

  const renderViewTab = () => (
    <div className="space-y-5">
      {/* Axis Widget Section */}
      <div className="space-y-3">
        <label className="text-xs uppercase tracking-wider text-neutral-500 font-semibold">Orientation Gizmo</label>
        
        <button
          onClick={() => setAxisWidget({ ...axisWidget, visible: !axisWidget.visible })}
          className={`w-full py-2 rounded text-xs font-medium border transition-colors ${axisWidget.visible ? 'bg-blue-600 border-blue-500 text-white' : 'bg-neutral-800 border-neutral-700 text-neutral-400'}`}
        >
          {axisWidget.visible ? 'Visible' : 'Hidden'}
        </button>

        <div className="bg-neutral-800 rounded-lg p-3 border border-neutral-700">
           <label className="text-[10px] text-neutral-400 block mb-2 text-center">Screen Position</label>
           <div className="grid grid-cols-3 gap-1 w-24 mx-auto">
              {[
                'top-left', 'top-center', 'top-right',
                'center-left', 'center-center', 'center-right',
                'bottom-left', 'bottom-center', 'bottom-right'
              ].map((pos) => (
                 <button
                   key={pos}
                   onClick={() => setAxisWidget({ ...axisWidget, alignment: pos as any })}
                   className={`w-full aspect-square rounded transition-colors ${axisWidget.alignment === pos ? 'bg-blue-500' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                   title={pos.replace('-', ' ')}
                 />
              ))}
           </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-64 bg-neutral-900 border-r border-neutral-700 flex flex-col h-full overflow-hidden">
      <div className="p-4 pb-0">
         <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500 mb-4">
           PolyPaint 3D
         </h1>
         {/* Tabs */}
         <div className="flex border-b border-neutral-700">
            <button
               onClick={() => setActiveTab('brush')}
               className={`flex-1 pb-2 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'brush' ? 'text-blue-400 border-blue-400' : 'text-neutral-500 border-transparent hover:text-neutral-300'}`}
            >
               <IconBrush className="w-4 h-4" /> Brush
            </button>
            <button
               onClick={() => setActiveTab('stencil')}
               className={`flex-1 pb-2 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'stencil' ? 'text-green-400 border-green-400' : 'text-neutral-500 border-transparent hover:text-neutral-300'}`}
            >
               <IconTarget className="w-4 h-4" /> Projection
            </button>
            <button
               onClick={() => setActiveTab('view')}
               className={`flex-1 pb-2 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors ${activeTab === 'view' ? 'text-yellow-400 border-yellow-400' : 'text-neutral-500 border-transparent hover:text-neutral-300'}`}
            >
               <IconEye className="w-4 h-4" /> View
            </button>
         </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pt-4 relative">
         {activeTab === 'brush' && renderBrushTab()}
         {activeTab === 'stencil' && renderStencilTab()}
         {activeTab === 'view' && renderViewTab()}
      </div>

      {/* Modals (Keep outside scroll area if possible or fix z-index) */}
      {showMaskModal && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-60 bg-neutral-800 border border-neutral-600 rounded-xl p-4 shadow-2xl z-50">
          <h3 className="text-sm font-bold mb-3 text-neutral-200">AI Mask</h3>
          <textarea
            className="w-full bg-neutral-900 border border-neutral-600 rounded p-2 text-white text-xs mb-3"
            rows={3}
            placeholder="Describe shape..."
            value={maskPrompt}
            onChange={(e) => setMaskPrompt(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowMaskModal(false)} className="text-xs text-neutral-400 px-2 py-1">Cancel</button>
            <button onClick={handleGenerateMask} disabled={isGeneratingMask} className="text-xs bg-purple-600 text-white px-3 py-1 rounded">Gen</button>
          </div>
        </div>
      )}
      
       {showLibraryModal && (
        <div className="absolute inset-4 bg-neutral-900/95 border border-neutral-600 rounded-xl p-4 z-50 flex flex-col">
          <div className="flex justify-between items-center mb-3">
             <h3 className="text-sm font-bold text-neutral-200">Library</h3>
             <button onClick={() => setShowLibraryModal(false)} className="text-neutral-500 hover:text-white">&times;</button>
          </div>
          <div className="grid grid-cols-4 gap-2 overflow-y-auto flex-1 content-start">
             {TIP_LIBRARY.map((tip, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSelectTip(tip.src)}
                  className={`aspect-square rounded border flex flex-col items-center justify-center p-1 ${brush.maskImage === tip.src ? 'border-blue-500 bg-neutral-800' : 'border-neutral-700'}`}
                >
                  {tip.src && <img src={tip.src} className="w-full h-full object-contain invert opacity-80" />}
                </button>
             ))}
          </div>
          <div className="mt-3 pt-3 border-t border-neutral-700">
             <label className="block w-full text-center py-2 border border-dashed border-neutral-600 rounded text-xs text-neutral-400 cursor-pointer hover:bg-neutral-800">
                Upload Custom Image
                <input type="file" className="hidden" accept="image/*" onChange={handleUploadTip} />
             </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default Toolbar;