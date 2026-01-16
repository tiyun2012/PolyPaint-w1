
import React, { useState, useEffect } from 'react';
import Scene from './components/Scene';
import Toolbar from './components/Toolbar';
import LayerManager from './components/LayerManager';
import { BrushSettings, Layer, StencilSettings, AxisWidgetSettings, Vec3 } from './types';
import { INITIAL_BRUSH } from './constants';
import { LayerAPI } from './services/layerService';
import { StencilAPI } from './services/stencilService';
import { eventBus, Events } from './services/eventBus';

function App() {
  const [brush, setBrush] = useState<BrushSettings>(INITIAL_BRUSH);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string>('');
  
  // Stencil State
  const [stencil, setStencil] = useState<StencilSettings>(StencilAPI.getDefaults());

  // Curve State
  const [curvePoints, setCurvePoints] = useState<Vec3[]>([]);

  // Axis Widget State (API to displace/place)
  const [axisWidget, setAxisWidget] = useState<AxisWidgetSettings>({
    visible: true,
    alignment: 'bottom-left',
    margin: [80, 80]
  });

  // Initialize first layer
  useEffect(() => {
    const baseLayer = LayerAPI.create('Base Layer');
    // Fill base layer with a color so it's not transparent
    LayerAPI.fill(baseLayer, '#666666');
    
    setLayers([baseLayer]);
    setActiveLayerId(baseLayer.id);
  }, []);

  // Event Listeners
  useEffect(() => {
    const handleProjectCommand = () => {
       // 1. Create a new layer specifically for this projection
       const projectionLayer = LayerAPI.create('Projection');
       
       // 2. Add it to state
       setLayers(prev => [...prev, projectionLayer]);
       setActiveLayerId(projectionLayer.id);
       
       // 3. Trigger projection after a brief delay to allow React to render the new layer into the Scene's closure
       // This ensures the Scene receives the updated 'layers' prop before we ask it to bake to one of them.
       setTimeout(() => {
          eventBus.emit(Events.REQ_BAKE_PROJECTION, { layerId: projectionLayer.id });
       }, 50);
    };

    const handleCurveClear = () => {
       setCurvePoints([]);
    };

    const unsubProject = eventBus.on(Events.CMD_PROJECT_STENCIL, handleProjectCommand);
    const unsubClear = eventBus.on(Events.CMD_CURVE_CLEAR, handleCurveClear);
    
    return () => { unsubProject(); unsubClear(); };
  }, []);

  const handleAddLayer = () => {
    const newLayer = LayerAPI.create(`Layer ${layers.length + 1}`);
    setLayers(prev => [...prev, newLayer]);
    setActiveLayerId(newLayer.id);
    eventBus.emit(Events.REFRESH_COMPOSITE);
  };

  const handleRemoveLayer = (id: string) => {
    const newLayers = LayerAPI.remove(layers, id);
    if (newLayers.length === layers.length) return; // No change
    
    setLayers(newLayers);
    if (activeLayerId === id) {
      setActiveLayerId(newLayers[newLayers.length - 1].id);
    }
    eventBus.emit(Events.REFRESH_COMPOSITE);
  };

  const handleToggleVisibility = (id: string) => {
    setLayers(prev => LayerAPI.toggleVisibility(prev, id));
    eventBus.emit(Events.REFRESH_COMPOSITE);
  };

  const handleUpdateLayerTexture = (id: string, imageSrc: string) => {
    const layer = layers.find(l => l.id === id);
    if (layer) {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.onload = () => {
        LayerAPI.drawTexture(layer, img);
        eventBus.emit(Events.REFRESH_COMPOSITE);
      };
      img.src = imageSrc;
    }
  };

  const handleFillLayer = () => {
     const layer = layers.find(l => l.id === activeLayerId);
     if (!layer) return;
     
     LayerAPI.fill(layer, brush.color);
     eventBus.emit(Events.REFRESH_COMPOSITE);
  };

  const handleReorderLayer = (id: string, direction: 'up' | 'down') => {
    setLayers(prev => LayerAPI.reorder(prev, id, direction));
    eventBus.emit(Events.REFRESH_COMPOSITE);
  };

  const handleRenameLayer = (id: string, newName: string) => {
     setLayers(prev => LayerAPI.rename(prev, id, newName));
  };

  return (
    <div className="flex w-screen h-screen bg-[#111] overflow-hidden font-sans">
      <Toolbar 
         brush={brush} 
         setBrush={setBrush} 
         stencil={stencil}
         setStencil={setStencil}
         axisWidget={axisWidget}
         setAxisWidget={setAxisWidget}
         onFillLayer={handleFillLayer}
         curvePointsCount={curvePoints.length}
      />
      
      <div className="flex-1 relative">
        <Scene 
          brush={brush} 
          layers={layers} 
          setLayers={setLayers}
          activeLayerId={activeLayerId}
          stencil={stencil}
          setStencil={setStencil}
          axisWidget={axisWidget}
          curvePoints={curvePoints}
          setCurvePoints={setCurvePoints}
        />
        
        {/* Info Overlay */}
        <div className="absolute top-4 left-4 pointer-events-none opacity-50 text-xs text-white">
          <p>PolyPaint Pro v1.2</p>
          <p className="mt-1">Active Layer: {layers.find(l => l.id === activeLayerId)?.name}</p>
          <p className="mt-1 opacity-70">Alt + Left Drag to Rotate View</p>
          {stencil.visible && stencil.mode === 'edit' && <p className="mt-1 text-green-400">Stencil Edit: {stencil.tool === 'select' ? 'Move Points' : 'Add Loop (Click near edge)'}</p>}
          {stencil.visible && stencil.mode === 'paint' && <p className="mt-1 text-blue-400">Stencil Paint Mode: Ready to Project or Paint</p>}
          {brush.mode === 'curve' && <p className="mt-1 text-purple-400">Curve Mode: Shift + Click to add points. Drag handles to adjust.</p>}
        </div>
      </div>

      <LayerManager
        layers={layers}
        activeLayerId={activeLayerId}
        onSelectLayer={setActiveLayerId}
        onAddLayer={handleAddLayer}
        onRemoveLayer={handleRemoveLayer}
        onToggleVisibility={handleToggleVisibility}
        onUpdateLayerTexture={handleUpdateLayerTexture}
        onReorderLayer={handleReorderLayer}
        onRenameLayer={handleRenameLayer}
      />
    </div>
  );
}

export default App;
