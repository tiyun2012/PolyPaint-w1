import React, { useRef, useMemo, useEffect, useState, useCallback, useImperativeHandle, forwardRef, Suspense } from 'react';
import { Canvas, useThree, useFrame, createPortal, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Environment, useCursor, useTexture, Line, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { BrushSettings, Layer, StencilSettings, AxisWidgetSettings } from '../types';
import { TEXTURE_SIZE } from '../constants';
import { Vec3, Vec3Utils, Vec2, Vec2Utils, TMP_VEC2_1, GridUtils, MeshUtils } from '../services/math';
import { BrushAPI } from '../services/brushService';
import { StencilAPI } from '../services/stencilService';
import { eventBus, Events } from '../services/eventBus';
import { Gizmo } from './Gizmo';

// Add TypeScript definitions for React Three Fiber elements
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      mesh: any;
      sphereGeometry: any;
      meshStandardMaterial: any;
      ambientLight: any;
      pointLight: any;
      gridHelper: any;
      planeGeometry: any;
      meshBasicMaterial: any;
      shaderMaterial: any;
      group: any; 
      primitive: any;
      lineSegments: any;
      lineBasicMaterial: any;
      color: any;
      canvasTexture: any;
    }
  }
}

interface SceneProps {
  brush: BrushSettings;
  layers: Layer[];
  activeLayerId: string;
  setLayers: React.Dispatch<React.SetStateAction<Layer[]>>;
  stencil: StencilSettings;
  setStencil?: any; 
  axisWidget: AxisWidgetSettings;
}

export interface ProjectionBakerHandle {
  bake: () => ImageData | null;
}

// ------------------------------------------------------------------
// HOOK: MAYA CONTROLS
// ------------------------------------------------------------------
const useMayaControls = () => {
  const [isAltPressed, setIsAltPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setIsAltPressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        setIsAltPressed(false);
      }
    };
    const handleBlur = () => setIsAltPressed(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const orbitProps = useMemo(() => ({
    makeDefault: true,
    enableDamping: true,
    dampingFactor: 0.1,
    enableRotate: isAltPressed,
    enablePan: isAltPressed,
    enableZoom: true,
    mouseButtons: {
        LEFT: isAltPressed ? THREE.MOUSE.ROTATE : undefined as unknown as THREE.MOUSE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.DOLLY
    }
  }), [isAltPressed]);

  return { isAltPressed, orbitProps };
};

// ------------------------------------------------------------------
// DRAGGABLE CORNER HANDLE
// ------------------------------------------------------------------
const CornerHandle = ({ 
  position, 
  onSelect,
  selected,
  visible
}: { 
  position: THREE.Vector3 | [number, number, number], 
  onSelect: (e: ThreeEvent<PointerEvent>) => void,
  selected: boolean,
  visible: boolean
}) => {
  const [hovered, setHover] = useState(false);
  useCursor(hovered && visible, 'pointer', 'auto');

  if (!visible) return null;

  return (
    <mesh
      position={position}
      onPointerOver={(e) => { e.stopPropagation(); setHover(true); }}
      onPointerOut={(e) => { e.stopPropagation(); setHover(false); }}
      onPointerDown={(e) => {
        e.stopPropagation(); 
        onSelect(e);
      }}
      renderOrder={9999} 
    >
      <sphereGeometry args={[0.025, 16, 16]} />
      <meshBasicMaterial color={selected ? "#ffff00" : "#00ff00"} depthTest={false} transparent opacity={0.8} />
    </mesh>
  );
};

// ------------------------------------------------------------------
// STENCIL PLANE COMPONENT
// ------------------------------------------------------------------
const StencilPlane = forwardRef<THREE.Group, { 
  image: string; 
  opacity: number; 
  aspectRatio: number; 
  mode: 'translate' | 'rotate' | 'scale';
  editable: boolean;
  tool: 'select' | 'loop';
  rowCuts: number[];
  colCuts: number[];
  onDragChange: (isDragging: boolean) => void;
  onLutUpdate: (texture: THREE.Texture | null, bounds: THREE.Vector4) => void;
  onAddLoop: (type: 'row' | 'col', val: number) => void;
}>(
  ({ image, opacity, aspectRatio, mode, editable, tool, rowCuts, colCuts, onDragChange, onLutUpdate, onAddLoop }, ref) => {
  const texture = useTexture(image);
  const { gl } = useThree();
  const groupRef = useRef<THREE.Group>(null!);
  const proxyRef = useRef<THREE.Group>(null!); 
  
  // Local state to toggle between translate and rotate for the Stencil
  // Currently we hardcode toggle on click for demo or expose prop.
  // The user requested 'rotate object mode'. We will assume a default 'rotate' capability
  // if 'tool' is 'select' and we are editing the WHOLE stencil.
  // But `tool` is 'select' (points) or 'loop'.
  // We need a mode to move the WHOLE stencil vs moving points.
  // Currently: `tool === 'select'` enables `CornerHandle`.
  // If no point selected, we want to move the whole plane.
  // Let's add a `gizmoMode` toggle. 
  const [gizmoMode, setGizmoMode] = useState<'translate' | 'rotate'>('translate');

  useImperativeHandle(ref, () => groupRef.current);

  // ------------------------------------------------------------------
  // GRID STATE
  // ------------------------------------------------------------------
  // Use GridUtils to initialize grid
  const [gridPoints, setGridPoints] = useState<Vec3[][]>(() => 
    GridUtils.create(2, 2, aspectRatio, 1.0)
  );
  
  const [selectedPoint, setSelectedPoint] = useState<{r: number, c: number} | null>(null);
  const [hoverLoop, setHoverLoop] = useState<{ type: 'row' | 'col', value: number } | null>(null);

  // ------------------------------------------------------------------
  // LUT GENERATION RESOURCES
  // ------------------------------------------------------------------
  const lutFBO = useMemo(() => new THREE.WebGLRenderTarget(1024, 1024, { 
      minFilter: THREE.LinearFilter, 
      magFilter: THREE.LinearFilter, 
      format: THREE.RGBAFormat,
      type: THREE.FloatType 
  }), []);
  const lutScene = useMemo(() => new THREE.Scene(), []);
  const lutCamera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const lutMaterial = useMemo(() => new THREE.ShaderMaterial({
      vertexShader: `
        varying vec2 vUV;
        void main() {
            vUV = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUV;
        void main() {
            gl_FragColor = vec4(vUV, 0.0, 1.0); // Store UV in R,G. Alpha=1 indicates valid
        }
      `,
      side: THREE.DoubleSide
  }), []);

  // ------------------------------------------------------------------
  // GEOMETRY GENERATION
  // ------------------------------------------------------------------
  const geometry = useMemo(() => new THREE.BufferGeometry(), [rowCuts.length, colCuts.length]); // Recreate if topology changes

  // Update Geometry BufferAttributes from MeshUtils
  useEffect(() => {
      const { positions, uvs, indices } = MeshUtils.generateGridMesh(gridPoints, rowCuts, colCuts);
      geometry.setIndex(indices);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.computeVertexNormals();
      
      // Correct property access for BufferAttribute update
      (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (geometry.attributes.uv as THREE.BufferAttribute).needsUpdate = true;

  }, [geometry, gridPoints, rowCuts, colCuts]);

  // ------------------------------------------------------------------
  // QUAD WIREFRAME GEOMETRY (Visual Only)
  // ------------------------------------------------------------------
  const wireframeGeometry = useMemo(() => {
      const positions = GridUtils.getWireframeVertices(gridPoints);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      return geo;
  }, [gridPoints]);

  // ------------------------------------------------------------------
  // LOOP ADDITION LOGIC
  // ------------------------------------------------------------------
  const handleInternalAddLoop = (type: 'row' | 'col', val: number) => {
      let newGrid;
      if (type === 'row') {
          // Find insertion index
          let insertIndex = 0;
          while (insertIndex < rowCuts.length && rowCuts[insertIndex] < val) insertIndex++;
          const prevRowIdx = Math.max(0, insertIndex - 1);
          const nextRowIdx = Math.min(rowCuts.length - 1, insertIndex);
          const vPrev = rowCuts[prevRowIdx];
          const vNext = rowCuts[nextRowIdx];
          
          let t = 0.5;
          if (vNext > vPrev) t = (val - vPrev) / (vNext - vPrev);
          
          // Use GridUtils to insert row
          // NOTE: GridUtils.insertRow expects index of 'previous' row to interpolate FROM.
          // Since insertIndex is where the NEW cut will go in the CUTS array,
          // The previous row in grid corresponds to prevRowIdx.
          newGrid = GridUtils.insertRow(gridPoints, t, prevRowIdx);
      } else {
          let insertIndex = 0;
          while (insertIndex < colCuts.length && colCuts[insertIndex] < val) insertIndex++;
          const prevColIdx = Math.max(0, insertIndex - 1);
          const nextColIdx = Math.min(colCuts.length - 1, insertIndex);
          const uPrev = colCuts[prevColIdx];
          const uNext = colCuts[nextColIdx];
          
          let t = 0.5;
          if (uNext > uPrev) t = (val - uPrev) / (uNext - uPrev);
          
          newGrid = GridUtils.insertCol(gridPoints, t, prevColIdx);
      }
      
      setGridPoints(newGrid);
      onAddLoop(type, val);
  };

  // ------------------------------------------------------------------
  // UPDATE LUT
  // ------------------------------------------------------------------
  useEffect(() => {
     // Wait for attributes to populate
     if (!geometry.attributes.position) return;

     // Calculate Bounds
     let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
     for(let r=0; r<gridPoints.length; r++) {
         for(let c=0; c<gridPoints[r].length; c++) {
             const p = gridPoints[r][c];
             minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
             minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
         }
     }

     const padding = 0.1;
     const lMinX = minX - padding;
     const lMaxX = maxX + padding;
     const lMinY = minY - padding;
     const lMaxY = maxY + padding;
     const width = lMaxX - lMinX;
     const height = lMaxY - lMinY;

     lutCamera.left = lMinX;
     lutCamera.right = lMaxX;
     lutCamera.top = lMaxY;
     lutCamera.bottom = lMinY;
     lutCamera.updateProjectionMatrix();

     // Reuse geometry in LUT Mesh
     const lutMesh = new THREE.Mesh(geometry, lutMaterial);
     lutScene.clear();
     lutScene.add(lutMesh);

     gl.setRenderTarget(lutFBO);
     gl.setClearColor(new THREE.Color(0, 0, 0), 0);
     gl.clear();
     gl.render(lutScene, lutCamera);
     gl.setRenderTarget(null);

     // Bounds Vector: MinX, MinY, Width, Height
     onLutUpdate(lutFBO.texture, new THREE.Vector4(lMinX, lMinY, width, height));

  }, [geometry, gridPoints, gl, lutFBO, lutScene, lutCamera, lutMaterial, onLutUpdate]);

  // ------------------------------------------------------------------
  // GIZMO SYNC
  // ------------------------------------------------------------------
  useEffect(() => {
    if (selectedPoint !== null) {
      const {r, c} = selectedPoint;
      if (gridPoints[r] && gridPoints[r][c]) {
          const pos = gridPoints[r][c];
          proxyRef.current.position.set(pos.x, pos.y, 0);
          proxyRef.current.updateMatrixWorld();
      }
    }
  }, [selectedPoint]); 

  const handleGizmoDrag = () => {
     if (selectedPoint !== null) {
        setGridPoints(prev => {
           const next = prev.map(row => row.map(v => Vec3Utils.clone(v)));
           const {r, c} = selectedPoint;
           const newPos = proxyRef.current.position; 
           next[r][c] = Vec3Utils.create(newPos.x, newPos.y, 0);
           return next;
        });
     }
  };
  
  // Toggle mode with keyboard 'R' for rotate, 'G' for grab/translate (Blender style)
  useEffect(() => {
     const handler = (e: KeyboardEvent) => {
         if (e.key.toLowerCase() === 'r') setGizmoMode('rotate');
         if (e.key.toLowerCase() === 'g') setGizmoMode('translate');
     };
     window.addEventListener('keydown', handler);
     return () => window.removeEventListener('keydown', handler);
  }, []);

  // ------------------------------------------------------------------
  // INTERACTIONS
  // ------------------------------------------------------------------
  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
     if (!editable || tool !== 'loop' || !e.uv) {
        setHoverLoop(null);
        return;
     }
     const u = e.uv.x;
     const v = e.uv.y;
     
     let minColDist = Infinity;
     for (const cut of colCuts) {
        const dist = Math.abs(u - cut);
        if (dist < minColDist) minColDist = dist;
     }
     let minRowDist = Infinity;
     for (const cut of rowCuts) {
        const dist = Math.abs(v - cut);
        if (dist < minRowDist) minRowDist = dist;
     }

     if (minColDist < minRowDist) setHoverLoop({ type: 'row', value: v });
     else setHoverLoop({ type: 'col', value: u });
  };

  const handleClick = (e: ThreeEvent<PointerEvent>) => {
      if (!editable) return;
      e.stopPropagation();
      if (tool === 'select') {
          // If we clicked background, deselect point, select WHOLE object logic (handled by Gizmo auto-target)
          setSelectedPoint(null); 
      }
      else if (tool === 'loop' && hoverLoop) {
         handleInternalAddLoop(hoverLoop.type, hoverLoop.value);
         setHoverLoop(null);
      }
  };

  return (
    <>
      <group ref={groupRef} position={[0, 0, 2.5]} onClick={handleClick} onPointerMove={handlePointerMove}>
         <mesh geometry={geometry}>
            <meshBasicMaterial 
               map={texture} 
               transparent={true} 
               opacity={opacity * 0.7} 
               side={THREE.DoubleSide}
               depthTest={false}
            />
         </mesh>

         {editable && (
            <lineSegments geometry={wireframeGeometry} renderOrder={9999}>
               <lineBasicMaterial color="white" depthTest={false} transparent opacity={0.4} />
            </lineSegments>
         )}
         
         <group ref={proxyRef} visible={false} />
         
         {editable && tool === 'select' && gridPoints.map((row, r) => 
             row.map((pos, c) => (
               <CornerHandle 
                 key={`${r}-${c}`}
                 position={[pos.x, pos.y, pos.z]} 
                 selected={selectedPoint?.r === r && selectedPoint?.c === c}
                 onSelect={(e) => setSelectedPoint({r, c})}
                 visible={true}
               />
             ))
         )}
      </group>
      
      {/* Gizmo Logic: If point selected, target proxy (translate only). If NO point selected, target Group (Translate OR Rotate) */}
      {editable && tool === 'select' && (
         <Gizmo 
           target={selectedPoint !== null ? proxyRef.current : groupRef.current}
           mode={selectedPoint !== null ? 'translate' : gizmoMode}
           onDragStart={() => onDragChange(true)}
           onDragEnd={() => onDragChange(false)}
           onDrag={handleGizmoDrag}
         />
      )}
    </>
  );
});

// ... rest of Scene.tsx (ProjectionPreview, ProjectionBaker, PaintableMesh, Scene)
// Copying previous content for context completion ...
const ProjectionPreview = ({ stencil, stencilMeshRef, lutTexture, lutBounds }: { 
    stencil: StencilSettings, 
    stencilMeshRef: React.MutableRefObject<THREE.Group | null>,
    lutTexture: THREE.Texture | null,
    lutBounds: THREE.Vector4
}) => {
  const shaderRef = useRef<THREE.ShaderMaterial>(null);
  const texture = useTexture(stencil.image!);

  useFrame(() => {
    if (stencilMeshRef.current && shaderRef.current && lutTexture) {
       stencilMeshRef.current.updateMatrixWorld();
       const inverse = stencilMeshRef.current.matrixWorld.clone().invert();
       shaderRef.current.uniforms.stencilInverseMatrix.value.copy(inverse);
       shaderRef.current.uniforms.opacity.value = stencil.opacity;
       shaderRef.current.uniforms.lutTexture.value = lutTexture;
       shaderRef.current.uniforms.lutBounds.value.copy(lutBounds);
    }
  });

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
       stencilTexture: { value: texture },
       lutTexture: { value: null },
       lutBounds: { value: new THREE.Vector4() },
       stencilInverseMatrix: { value: new THREE.Matrix4() },
       opacity: { value: stencil.opacity }
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D stencilTexture;
      uniform sampler2D lutTexture;
      uniform vec4 lutBounds; // MinX, MinY, Width, Height
      uniform mat4 stencilInverseMatrix;
      uniform float opacity;
      varying vec3 vWorldPos;
      
      void main() {
         vec4 localPos = stencilInverseMatrix * vec4(vWorldPos, 1.0);
         vec2 lutUV = (localPos.xy - lutBounds.xy) / lutBounds.zw;
         if (lutUV.x < 0.0 || lutUV.x > 1.0 || lutUV.y < 0.0 || lutUV.y > 1.0) discard;
         vec4 stencilMap = texture2D(lutTexture, lutUV);
         if (stencilMap.a < 0.5) discard;
         vec2 uv = stencilMap.xy;
         if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
         vec4 color = texture2D(stencilTexture, uv);
         if (color.a < 0.01) discard;
         gl_FragColor = vec4(color.rgb, color.a * opacity);
      }
    `,
    transparent: true,
    depthWrite: false, 
    polygonOffset: true,
    polygonOffsetFactor: -2, 
    side: THREE.FrontSide
  }), [texture]);

  useEffect(() => {
    if (shaderRef.current) {
        shaderRef.current.uniforms.stencilTexture.value = texture;
    }
  }, [texture]);

  return (
    <mesh>
       <sphereGeometry args={[2, 64, 64]} /> 
       <primitive object={material} ref={shaderRef} attach="material" />
    </mesh>
  );
};

const ProjectionBaker = forwardRef<ProjectionBakerHandle, any>(({ stencil, meshGeometry, stencilObjectRef, lutTexture, lutBounds }, ref) => {
  const { gl } = useThree();
  const fbo = useMemo(() => new THREE.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, { samples: 4 }), []);
  const scene = useMemo(() => new THREE.Scene(), []);
  const camera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const stencilTexture = useTexture(stencil.image!); 

  const bakeMaterial = useMemo(() => {
     return new THREE.ShaderMaterial({
        uniforms: {
           stencilTexture: { value: null },
           lutTexture: { value: null },
           lutBounds: { value: new THREE.Vector4() },
           stencilInverseMatrix: { value: new THREE.Matrix4() },
           opacity: { value: 1.0 }
        },
        vertexShader: `
          varying vec3 vWorldPos;
          void main() {
            vec2 clipSpace = uv * 2.0 - 1.0;
            gl_Position = vec4(clipSpace, 0.0, 1.0);
            vWorldPos = position; 
          }
        `,
        fragmentShader: `
          uniform sampler2D stencilTexture;
          uniform sampler2D lutTexture;
          uniform vec4 lutBounds;
          uniform mat4 stencilInverseMatrix;
          uniform float opacity;
          varying vec3 vWorldPos;
          
          void main() {
             vec4 localPos = stencilInverseMatrix * vec4(vWorldPos, 1.0);
             vec2 lutUV = (localPos.xy - lutBounds.xy) / lutBounds.zw;
             if (lutUV.x < 0.0 || lutUV.x > 1.0 || lutUV.y < 0.0 || lutUV.y > 1.0) discard;
             vec4 stencilMap = texture2D(lutTexture, lutUV);
             if (stencilMap.a < 0.5) discard;
             vec2 uv = stencilMap.xy;
             if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
             vec4 color = texture2D(stencilTexture, uv);
             if (color.a < 0.1) discard;
             gl_FragColor = vec4(color.rgb, color.a * opacity);
          }
        `,
        side: THREE.DoubleSide,
        transparent: true
     });
  }, []);

  const triggerBake = useCallback(() => {
     if (!stencilObjectRef.current || !stencilTexture || !lutTexture) return null;
     (stencilTexture as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
     const stencilMesh = stencilObjectRef.current;
     stencilMesh.updateMatrixWorld();
     const inverseMatrix = stencilMesh.matrixWorld.clone().invert();
     bakeMaterial.uniforms.stencilTexture.value = stencilTexture;
     bakeMaterial.uniforms.lutTexture.value = lutTexture;
     bakeMaterial.uniforms.lutBounds.value.copy(lutBounds);
     bakeMaterial.uniforms.stencilInverseMatrix.value = inverseMatrix;
     bakeMaterial.uniforms.opacity.value = stencil.opacity;
     
     const bakeMesh = new THREE.Mesh(meshGeometry, bakeMaterial);
     scene.add(bakeMesh);
     gl.setRenderTarget(fbo);
     gl.setClearColor(new THREE.Color(0, 0, 0), 0);
     gl.clear();
     gl.render(scene, camera);
     gl.setRenderTarget(null);
     
     const buffer = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
     gl.readRenderTargetPixels(fbo, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE, buffer);
     scene.remove(bakeMesh);
     return new ImageData(new Uint8ClampedArray(buffer), TEXTURE_SIZE, TEXTURE_SIZE);
  }, [gl, fbo, scene, camera, bakeMaterial, stencil, stencilTexture, lutTexture, lutBounds, meshGeometry, stencilObjectRef]);

  useImperativeHandle(ref, () => ({ bake: triggerBake }));
  return null;
});

const PaintableMesh: React.FC<SceneProps & { setStencil?: (s: any) => void; isAltPressed: boolean }> = ({ 
  brush, layers, activeLayerId, stencil, setStencil, isAltPressed 
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHover] = useState(false);
  const [gizmoDragging, setGizmoDragging] = useState(false);
  const isPaintingRef = useRef(false);
  const lastUVRef = useRef<Vec2 | null>(null); 
  const distanceAccumulatorRef = useRef(0);
  const compositeDirtyRef = useRef(false);
  const isInteractingWithStencil = gizmoDragging;
  const isStencilEditMode = stencil.visible && stencil.mode === 'edit';
  const stencilMeshRef = useRef<THREE.Group>(null);
  const bakerRef = useRef<ProjectionBakerHandle>(null);
  
  const [lutTexture, setLutTexture] = useState<THREE.Texture | null>(null);
  const [lutBounds, setLutBounds] = useState(new THREE.Vector4());

  const handleLutUpdate = useCallback((tex: THREE.Texture | null, bounds: THREE.Vector4) => {
      setLutTexture(tex);
      setLutBounds(bounds.clone());
  }, []);

  const handleAddLoop = useCallback((type: 'row' | 'col', val: number) => {
      if (!setStencil) return;
      setStencil((prev: StencilSettings) => {
          const prevCuts = type === 'row' ? prev.rowCuts : prev.colCuts;
          const newCuts = StencilAPI.addCut(prevCuts, val);
          return {
              ...prev,
              rowCuts: type === 'row' ? newCuts : prev.rowCuts,
              colCuts: type === 'col' ? newCuts : prev.colCuts
          };
      });
  }, [setStencil]);

  useEffect(() => {
    const handleBakeRequest = (data: { layerId: string }) => {
        if (!bakerRef.current) return;
        const targetId = data.layerId;
        const layer = layers.find(l => l.id === targetId);
        if (!layer) return;

        const imageData = bakerRef.current.bake();
        if (!imageData) return;

        const tempCvs = document.createElement('canvas');
        tempCvs.width = TEXTURE_SIZE;
        tempCvs.height = TEXTURE_SIZE;
        const tempCtx = tempCvs.getContext('2d');
        if (!tempCtx) return;
        
        tempCtx.putImageData(imageData, 0, 0);
        layer.ctx.save();
        layer.ctx.globalCompositeOperation = 'source-over';
        layer.ctx.globalAlpha = 1.0;
        layer.ctx.scale(1, -1);
        layer.ctx.drawImage(tempCvs, 0, -TEXTURE_SIZE);
        layer.ctx.restore();
        
        compositeDirtyRef.current = true;
    };

    const handleCompositeUpdate = () => { compositeDirtyRef.current = true; };
    const unsubBake = eventBus.on(Events.REQ_BAKE_PROJECTION, handleBakeRequest);
    const unsubComp = eventBus.on(Events.REFRESH_COMPOSITE, handleCompositeUpdate);
    return () => { unsubBake(); unsubComp(); };
  }, [layers]); 

  useEffect(() => { compositeDirtyRef.current = true; }, [layers]);

  const compositeCanvas = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    return canvas;
  }, []);
  
  const compositeTexture = useMemo(() => {
    const tex = new THREE.CanvasTexture(compositeCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false; 
    return tex;
  }, [compositeCanvas]);
  
  useFrame(() => {
    if (compositeDirtyRef.current) {
        const ctx = compositeCanvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
            layers.forEach(layer => {
              if (layer.visible) {
                ctx.globalAlpha = layer.opacity;
                ctx.drawImage(layer.canvas, 0, 0);
              }
            });
            compositeTexture.needsUpdate = true;
        }
        compositeDirtyRef.current = false;
    }
  });

  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  useEffect(() => {
     if (brush.maskImage) {
        BrushAPI.processMaskTip(brush.maskImage).then(mask => { maskCanvasRef.current = mask; });
     } else { maskCanvasRef.current = null; }
  }, [brush.maskImage]);

  const drawStamp = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number) => {
      const size = brush.size;
      const radius = size / 2;
      let posX = x;
      let posY = y;
      if (brush.positionJitter > 0) {
         const jitterAmount = brush.size * brush.positionJitter;
         posX += (Math.random() - 0.5) * jitterAmount;
         posY += (Math.random() - 0.5) * jitterAmount;
      }
      let angle = (brush.rotation * Math.PI) / 180;
      if (brush.rotationJitter > 0) {
         angle += (Math.random() - 0.5) * 2 * Math.PI * brush.rotationJitter;
      }
      ctx.save();
      ctx.translate(posX, posY);
      ctx.rotate(angle);
      ctx.translate(-posX, -posY);
      ctx.globalAlpha = brush.opacity * brush.flow;
      if (brush.mode === 'erase') { ctx.globalCompositeOperation = 'destination-out'; } else { ctx.globalCompositeOperation = 'source-over'; }
      const drawX = posX - radius;
      const drawY = posY - radius;
      if (maskCanvasRef.current) {
          const mask = maskCanvasRef.current;
          if (brush.mode === 'paint') {
              if (!tintCanvasRef.current) tintCanvasRef.current = document.createElement('canvas');
              const tCvs = tintCanvasRef.current;
              if (tCvs.width !== size || tCvs.height !== size) { tCvs.width = size; tCvs.height = size; }
              const tCtx = tCvs.getContext('2d')!;
              tCtx.clearRect(0, 0, size, size);
              tCtx.globalCompositeOperation = 'source-over';
              tCtx.fillStyle = brush.color;
              tCtx.fillRect(0, 0, size, size);
              tCtx.globalCompositeOperation = 'destination-in';
              tCtx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, size, size);
              if (brush.textureMix > 0) {
                  tCtx.globalCompositeOperation = 'source-over';
                  tCtx.globalAlpha = brush.textureMix;
                  tCtx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, size, size);
              }
              ctx.drawImage(tCvs, drawX, drawY, size, size);
          } else {
              ctx.drawImage(mask, 0, 0, mask.width, mask.height, drawX, drawY, size, size);
          }
      } else {
          if (brush.mode === 'paint') ctx.fillStyle = brush.color;
          else ctx.fillStyle = '#ffffff'; 
          ctx.beginPath(); 
          ctx.arc(posX, posY, radius, 0, Math.PI*2); 
          ctx.fill();
      }
      ctx.restore();
  }, [brush]);
  
  const paintStroke = useCallback((uv: THREE.Vector2) => {
     const layer = layers.find(l => l.id === activeLayerId);
     if (!layer) return;
     const currentX = uv.x * TEXTURE_SIZE;
     const currentY = (1 - uv.y) * TEXTURE_SIZE;
     const currentVec = Vec2Utils.create(currentX, currentY);
     if (!lastUVRef.current) {
        drawStamp(layer.ctx, currentX, currentY);
        lastUVRef.current = currentVec;
        compositeDirtyRef.current = true;
        return;
     }
     const dist = Vec2Utils.distance(lastUVRef.current, currentVec);
     const stepSize = Math.max(1, brush.size * brush.spacing);
     distanceAccumulatorRef.current += dist;
     while (distanceAccumulatorRef.current >= stepSize) {
        Vec2Utils.subtract(currentVec, lastUVRef.current!, TMP_VEC2_1);
        Vec2Utils.normalize(TMP_VEC2_1, TMP_VEC2_1);
        Vec2Utils.scale(TMP_VEC2_1, stepSize, TMP_VEC2_1);
        const nextPos = Vec2Utils.create(); 
        Vec2Utils.add(lastUVRef.current!, TMP_VEC2_1, nextPos);
        drawStamp(layer.ctx, nextPos.x, nextPos.y);
        lastUVRef.current = nextPos;
        distanceAccumulatorRef.current -= stepSize;
     }
     compositeDirtyRef.current = true;
  }, [activeLayerId, layers, drawStamp, brush.spacing, brush.size]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
     if (isAltPressed) return;
     if (!isInteractingWithStencil && !isStencilEditMode && e.uv) {
        eventBus.emit(Events.PAINT_START, { layerId: activeLayerId, tool: brush.mode, uv: e.uv });
        isPaintingRef.current = true;
        lastUVRef.current = null; 
        distanceAccumulatorRef.current = 0;
        paintStroke(e.uv);
        (e.nativeEvent.target as HTMLElement).setPointerCapture(e.pointerId);
     }
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
     if (isAltPressed) return;
     if (isPaintingRef.current && !isInteractingWithStencil && !isStencilEditMode && e.uv) {
        paintStroke(e.uv);
     }
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
     if (isPaintingRef.current) {
        eventBus.emit(Events.PAINT_END, { layerId: activeLayerId });
     }
     isPaintingRef.current = false;
     lastUVRef.current = null;
     try { (e.nativeEvent.target as HTMLElement).releasePointerCapture(e.pointerId); } catch(err){}
  };

  return (
    <>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHover(true)}
        onPointerOut={() => setHover(false)}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <sphereGeometry args={[2, 64, 64]} /> 
        <meshStandardMaterial map={compositeTexture} roughness={0.5} metalness={0.1} transparent={true} />
      </mesh>

      {stencil.visible && stencil.image && (
        <Suspense fallback={null}>
            <StencilPlane 
              image={stencil.image}
              opacity={stencil.opacity}
              aspectRatio={stencil.aspectRatio}
              mode={undefined as any}
              ref={stencilMeshRef}
              editable={stencil.mode === 'edit'}
              tool={stencil.tool}
              rowCuts={stencil.rowCuts}
              colCuts={stencil.colCuts}
              onDragChange={setGizmoDragging}
              onLutUpdate={handleLutUpdate}
              onAddLoop={handleAddLoop}
            />
            
            <ProjectionPreview 
               stencil={stencil}
               stencilMeshRef={stencilMeshRef}
               lutTexture={lutTexture}
               lutBounds={lutBounds}
            />
            
             <ProjectionBaker 
               ref={bakerRef}
               stencil={stencil}
               meshGeometry={meshRef.current?.geometry}
               stencilObjectRef={stencilMeshRef}
               lutTexture={lutTexture}
               lutBounds={lutBounds}
             />
        </Suspense>
      )}
    </>
  );
};

const Scene: React.FC<SceneProps> = (props) => {
  const { isAltPressed, orbitProps } = useMayaControls();
  const { axisWidget } = props;

  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 50 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
    >
      <color attach="background" args={['#111']} />
      <ambientLight intensity={0.7} />
      <pointLight position={[10, 10, 10]} />
      <Environment preset="city" />
      
      <OrbitControls {...orbitProps} />
      
      {axisWidget.visible && (
        <GizmoHelper alignment={axisWidget.alignment} margin={axisWidget.margin}>
          <GizmoViewport 
            axisColors={['#ff3653', '#8adb00', '#2c8fdf']} 
            labelColor="black"
            hideNegativeAxes={false}
          />
        </GizmoHelper>
      )}
      
      <PaintableMesh {...props} isAltPressed={isAltPressed} />
    </Canvas>
  );
};

export default Scene;