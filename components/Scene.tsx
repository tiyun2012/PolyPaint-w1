
import React, { useRef, useMemo, useEffect, useState, useCallback, useImperativeHandle, forwardRef, Suspense } from 'react';
import { Canvas, useThree, useFrame, createPortal, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Environment, useCursor, useTexture, Line, GizmoHelper, GizmoViewport, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { BrushSettings, Layer, StencilSettings, AxisWidgetSettings, Vec3 } from '../types';
import { TEXTURE_SIZE } from '../constants';
import { Vec3Utils, Vec2, Vec2Utils, TMP_VEC2_1, GridUtils, MeshUtils } from '../services/math';
import { BrushAPI } from '../services/brushService';
import { StencilAPI } from '../services/stencilService';
import { eventBus, Events } from '../services/eventBus';
import { Gizmo } from './Gizmo';
import { GizmoMode } from '../services/GizmoRenderer';
import { BezierCurve } from './BezierCurve';

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
      instancedMesh: any;
      boxGeometry: any;
      ringGeometry: any;
      circleGeometry: any;
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
  curvePoints?: Vec3[];
  setCurvePoints?: React.Dispatch<React.SetStateAction<Vec3[]>>;
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
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');

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
  
  // Toggle mode with keyboard 'R' for rotate, 'G' for grab/translate, 'S' for scale
  useEffect(() => {
     const handler = (e: KeyboardEvent) => {
         if (e.key.toLowerCase() === 'r') setGizmoMode('rotate');
         if (e.key.toLowerCase() === 'g') setGizmoMode('translate');
         if (e.key.toLowerCase() === 's') setGizmoMode('scale');
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
      
      {/* Gizmo Logic: If point selected, target proxy (translate only). If NO point selected, target Group (Translate/Rotate/Scale) */}
      {editable && tool === 'select' && (
         <Gizmo 
           target={selectedPoint !== null ? proxyRef.current : groupRef.current}
           mode={selectedPoint !== null ? 'translate' : gizmoMode}
           onDragStart={() => onDragChange(true)}
           onDragEnd={() => onDragChange(false)}
           onDrag={handleGizmoDrag}
           onModeChange={selectedPoint === null ? (m) => setGizmoMode(m) : undefined}
         />
      )}
    </>
  );
});

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
       
       // Calculate World Direction for Culling
       const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(stencilMeshRef.current.quaternion).normalize();
       shaderRef.current.uniforms.stencilDir.value.copy(forward);

       shaderRef.current.uniforms.opacity.value = stencil.opacity;
       shaderRef.current.uniforms.lutTexture.value = lutTexture;
       shaderRef.current.uniforms.lutBounds.value.copy(lutBounds);
       shaderRef.current.uniforms.cullBackfaces.value = stencil.cullBackfaces;
    }
  });

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
       stencilTexture: { value: texture },
       lutTexture: { value: null },
       lutBounds: { value: new THREE.Vector4() },
       stencilInverseMatrix: { value: new THREE.Matrix4() },
       stencilDir: { value: new THREE.Vector3(0,0,1) },
       opacity: { value: stencil.opacity },
       cullBackfaces: { value: true }
    },
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D stencilTexture;
      uniform sampler2D lutTexture;
      uniform vec4 lutBounds;
      uniform mat4 stencilInverseMatrix;
      uniform vec3 stencilDir;
      uniform float opacity;
      uniform bool cullBackfaces;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      
      void main() {
         // Backface Culling: If normal points same direction as stencil (both +Z), it's backface
         if (cullBackfaces) {
             if (dot(vNormal, stencilDir) > 0.0) discard;
         }

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
           stencilDir: { value: new THREE.Vector3(0,0,1) },
           opacity: { value: 1.0 },
           cullBackfaces: { value: true }
        },
        vertexShader: `
          varying vec3 vWorldPos;
          varying vec3 vNormal;
          void main() {
            vec2 clipSpace = uv * 2.0 - 1.0;
            gl_Position = vec4(clipSpace, 0.0, 1.0);
            vWorldPos = position; 
            vNormal = normalize(normal); 
          }
        `,
        fragmentShader: `
          uniform sampler2D stencilTexture;
          uniform sampler2D lutTexture;
          uniform vec4 lutBounds;
          uniform mat4 stencilInverseMatrix;
          uniform vec3 stencilDir;
          uniform float opacity;
          uniform bool cullBackfaces;
          varying vec3 vWorldPos;
          varying vec3 vNormal;
          
          void main() {
             if (cullBackfaces) {
                 // Check World Space dot product
                 // Note: vNormal here is model-space normal if not transformed.
                 // But in baker, we pass 'position' and 'normal' from mesh geometry.
                 // Is vNormal World Space? NO. It is Local Space of the mesh being painted.
                 // However, PaintableMesh is usually at (0,0,0) with identity rotation.
                 // If the mesh was rotated, we'd need to multiply vNormal by modelMatrix.
                 // Assuming standard Sphere at identity transform for now.
                 if (dot(vNormal, stencilDir) > 0.0) discard;
             }

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
     
     // Calculate World Direction for Culling
     const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(stencilMesh.quaternion).normalize();

     bakeMaterial.uniforms.stencilTexture.value = stencilTexture;
     bakeMaterial.uniforms.lutTexture.value = lutTexture;
     bakeMaterial.uniforms.lutBounds.value.copy(lutBounds);
     bakeMaterial.uniforms.stencilInverseMatrix.value = inverseMatrix;
     bakeMaterial.uniforms.stencilDir.value.copy(forward);
     bakeMaterial.uniforms.opacity.value = stencil.opacity;
     bakeMaterial.uniforms.cullBackfaces.value = stencil.cullBackfaces;
     
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
  brush, layers, activeLayerId, stencil, setStencil, isAltPressed, curvePoints, setCurvePoints 
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
  
  // Raycaster for robust curve projection
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  // Curve Drag State
  const [draggingCurveIdx, setDraggingCurveIdx] = useState<number | null>(null);

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

  // Curve Logic Helper
  const addCurvePoint = useCallback((p: THREE.Vector3) => {
     if (!setCurvePoints || !curvePoints) return;
     const pt: Vec3 = { x: p.x, y: p.y, z: p.z };
     
     if (curvePoints.length === 0) {
         setCurvePoints([pt]);
     } else {
         const lastAnchor = new THREE.Vector3(curvePoints[curvePoints.length-1].x, curvePoints[curvePoints.length-1].y, curvePoints[curvePoints.length-1].z);
         const newPoint = p;
         const c1 = new THREE.Vector3().lerpVectors(lastAnchor, newPoint, 0.33);
         const c2 = new THREE.Vector3().lerpVectors(lastAnchor, newPoint, 0.66);
         setCurvePoints(prev => [...prev, {x:c1.x,y:c1.y,z:c1.z}, {x:c2.x,y:c2.y,z:c2.z}, pt]);
     }
  }, [curvePoints, setCurvePoints]);

  const updateCurvePoint = useCallback((idx: number, p: THREE.Vector3) => {
      if (!setCurvePoints || !curvePoints) return;
      const pts = [...curvePoints];
      const old = new THREE.Vector3(pts[idx].x, pts[idx].y, pts[idx].z);
      const delta = p.clone().sub(old);
      pts[idx] = { x: p.x, y: p.y, z: p.z };

      // Anchor Move Logic
      if (idx % 3 === 0) {
         if (idx - 1 >= 0) {
            const prev = new THREE.Vector3(pts[idx-1].x, pts[idx-1].y, pts[idx-1].z).add(delta);
            pts[idx-1] = { x: prev.x, y: prev.y, z: prev.z };
         }
         if (idx + 1 < pts.length) {
            const next = new THREE.Vector3(pts[idx+1].x, pts[idx+1].y, pts[idx+1].z).add(delta);
            pts[idx+1] = { x: next.x, y: next.y, z: next.z };
         }
      }
      setCurvePoints(pts);
  }, [curvePoints, setCurvePoints]);

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
    
    // Curve Rasterization
    const handleCurveStroke = () => renderCurve('stroke', layers.find(l => l.id === activeLayerId)?.ctx);
    const handleCurveFill = () => renderCurve('fill', layers.find(l => l.id === activeLayerId)?.ctx);

    const unsubBake = eventBus.on(Events.REQ_BAKE_PROJECTION, handleBakeRequest);
    const unsubStroke = eventBus.on(Events.CMD_CURVE_STROKE, handleCurveStroke);
    const unsubFill = eventBus.on(Events.CMD_CURVE_FILL, handleCurveFill);
    const unsubComp = eventBus.on(Events.REFRESH_COMPOSITE, () => { compositeDirtyRef.current = true; });

    return () => { unsubBake(); unsubStroke(); unsubFill(); unsubComp(); };
  }, [layers, curvePoints, activeLayerId]); 

  // Create a separate Preview Canvas for Live Curve Preview
  const previewCanvas = useMemo(() => {
      const cvs = document.createElement('canvas');
      cvs.width = TEXTURE_SIZE;
      cvs.height = TEXTURE_SIZE;
      return cvs;
  }, []);

  const renderCurve = useCallback((type: 'stroke' | 'fill' | 'none', targetCtx?: CanvasRenderingContext2D | null) => {
      if (!curvePoints || curvePoints.length < 2 || type === 'none' || !targetCtx || !meshRef.current) return;
      
      const path = new THREE.CurvePath<THREE.Vector3>();
      const offset = 0.5; // Offset start points further out to ensure raycast hits top surface
      const project = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z).normalize().multiplyScalar(2.0 + offset);

      for (let i = 0; i < curvePoints.length - 3; i += 3) {
          path.add(new THREE.CubicBezierCurve3(
              project(curvePoints[i]),
              project(curvePoints[i+1]),
              project(curvePoints[i+2]),
              project(curvePoints[i+3])
          ));
      }

      const subdivisions = Math.max(200, path.curves.length * 50);
      const points = path.getPoints(subdivisions);

      if (type === 'stroke') {
          // Temporarily store original state to avoid side effects on manual painting
          const prevLastUV = lastUVRef.current;
          const prevDist = distanceAccumulatorRef.current;
          
          lastUVRef.current = null;
          distanceAccumulatorRef.current = 0;

          points.forEach(p => {
              // Robust Projection: Raycast from outer point towards center/mesh to find exact surface UV
              const dir = p.clone().negate().normalize();
              raycaster.set(p, dir);
              const intersects = raycaster.intersectObject(meshRef.current!, false);
              
              if (intersects.length > 0) {
                  const uv = intersects[0].uv;
                  if (uv) paintStroke(uv, 1.0, true, targetCtx);
              }
          });

          // Restore state
          lastUVRef.current = prevLastUV;
          distanceAccumulatorRef.current = prevDist;
      } else {
          // Fill: Collect UVs first via Raycast
          const uvPoints: THREE.Vector2[] = [];
          
          points.forEach(p => {
              const dir = p.clone().negate().normalize();
              raycaster.set(p, dir);
              const intersects = raycaster.intersectObject(meshRef.current!, false);
              if (intersects.length > 0 && intersects[0].uv) {
                  uvPoints.push(intersects[0].uv);
              }
          });
          
          if (uvPoints.length > 2) {
            targetCtx.fillStyle = brush.color;
            targetCtx.globalAlpha = brush.opacity;
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.beginPath();
            targetCtx.moveTo(uvPoints[0].x * TEXTURE_SIZE, (1 - uvPoints[0].y) * TEXTURE_SIZE);
            for(let i=1; i<uvPoints.length; i++) {
                targetCtx.lineTo(uvPoints[i].x * TEXTURE_SIZE, (1 - uvPoints[i].y) * TEXTURE_SIZE);
            }
            targetCtx.closePath();
            targetCtx.fill();
          }
      }
      compositeDirtyRef.current = true;
  }, [curvePoints, brush]);

  // Live Curve Preview Effect
  useEffect(() => {
     // Clear preview canvas first
     const ctx = previewCanvas.getContext('2d');
     if(ctx) ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

     if (brush.mode === 'curve' && brush.curvePreviewMode !== 'none') {
         renderCurve(brush.curvePreviewMode, ctx);
     } else {
         compositeDirtyRef.current = true; // Ensure clearing if mode changed to none
     }
  }, [curvePoints, brush.curvePreviewMode, brush.size, brush.color, brush.opacity, brush.maskImage, brush.spacing, renderCurve]);

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
            
            // Composite Curve Preview on top
            if (brush.mode === 'curve' && brush.curvePreviewMode !== 'none') {
                ctx.globalAlpha = 1.0; 
                ctx.drawImage(previewCanvas, 0, 0);
            }

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

  const drawStamp = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, pressure: number = 1.0) => {
      // Calculate dynamic size/opacity based on pressure if enabled
      // If usePressure is false, we ignore the pressure arg (default 1.0)
      const pFactor = brush.usePressure ? pressure : 1.0;
      
      // Heuristic: Pressure affects Size slightly (50%-100%) and Opacity/Flow heavily
      const dynamicSize = brush.size * (brush.usePressure ? (0.5 + 0.5 * pFactor) : 1.0);
      const dynamicOpacity = brush.opacity * (brush.usePressure ? Math.max(0.1, pFactor) : 1.0);
      
      const radius = dynamicSize / 2;
      
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
      
      ctx.globalAlpha = dynamicOpacity * brush.flow;
      
      if (brush.mode === 'erase') { ctx.globalCompositeOperation = 'destination-out'; } else { ctx.globalCompositeOperation = 'source-over'; }
      const drawX = posX - radius;
      const drawY = posY - radius;
      if (maskCanvasRef.current) {
          const mask = maskCanvasRef.current;
          if (brush.mode === 'paint') {
              if (!tintCanvasRef.current) tintCanvasRef.current = document.createElement('canvas');
              const tCvs = tintCanvasRef.current;
              if (tCvs.width !== dynamicSize || tCvs.height !== dynamicSize) { tCvs.width = dynamicSize; tCvs.height = dynamicSize; }
              const tCtx = tCvs.getContext('2d')!;
              tCtx.clearRect(0, 0, dynamicSize, dynamicSize);
              tCtx.globalCompositeOperation = 'source-over';
              tCtx.fillStyle = brush.color;
              tCtx.fillRect(0, 0, dynamicSize, dynamicSize);
              tCtx.globalCompositeOperation = 'destination-in';
              tCtx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, dynamicSize, dynamicSize);
              if (brush.textureMix > 0) {
                  tCtx.globalCompositeOperation = 'source-over';
                  tCtx.globalAlpha = brush.textureMix;
                  tCtx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, dynamicSize, dynamicSize);
              }
              ctx.drawImage(tCvs, drawX, drawY, dynamicSize, dynamicSize);
          } else {
              ctx.drawImage(mask, 0, 0, mask.width, mask.height, drawX, drawY, dynamicSize, dynamicSize);
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
  
  const paintStroke = useCallback((uv: THREE.Vector2, pressure: number = 1.0, force: boolean = false, targetCtx?: CanvasRenderingContext2D) => {
     let ctx: CanvasRenderingContext2D | null = null;
     if (targetCtx) {
        ctx = targetCtx;
     } else {
        const layer = layers.find(l => l.id === activeLayerId);
        if (layer) ctx = layer.ctx;
     }

     if (!ctx) return;

     const currentX = uv.x * TEXTURE_SIZE;
     const currentY = (1 - uv.y) * TEXTURE_SIZE;
     const currentVec = Vec2Utils.create(currentX, currentY);
     
     if (!lastUVRef.current || force) {
        drawStamp(ctx, currentX, currentY, pressure);
        lastUVRef.current = currentVec;
        compositeDirtyRef.current = true;
        return;
     }
     
     const dist = Vec2Utils.distance(lastUVRef.current, currentVec);
     const stepSize = Math.max(1, brush.size * brush.spacing); // Ensure stepSize is at least 1px to prevent freeze
     
     distanceAccumulatorRef.current += dist;
     
     while (distanceAccumulatorRef.current >= stepSize) {
        Vec2Utils.subtract(currentVec, lastUVRef.current!, TMP_VEC2_1);
        Vec2Utils.normalize(TMP_VEC2_1, TMP_VEC2_1);
        Vec2Utils.scale(TMP_VEC2_1, stepSize, TMP_VEC2_1);
        const nextPos = Vec2Utils.create(); 
        Vec2Utils.add(lastUVRef.current!, TMP_VEC2_1, nextPos);
        drawStamp(ctx, nextPos.x, nextPos.y, pressure);
        lastUVRef.current = nextPos;
        distanceAccumulatorRef.current -= stepSize;
     }
     compositeDirtyRef.current = true;
  }, [activeLayerId, layers, drawStamp, brush.spacing, brush.size]);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
     if (isAltPressed) return;
     if (gizmoDragging) return;

     if (brush.mode === 'curve') {
        // Curve Logic: If we hit handle, it's handled by CurveOverlay via stopPropagation. 
        // If we reach here, we are clicking the mesh -> Add point.
        if (e.point) {
            // Normalize to surface (Radius 2)
            const p = e.point.clone().normalize().multiplyScalar(2.0);
            addCurvePoint(p);
        }
        return;
     }

     if (!isInteractingWithStencil && !isStencilEditMode && e.uv) {
        eventBus.emit(Events.PAINT_START, { layerId: activeLayerId, tool: brush.mode, uv: e.uv });
        isPaintingRef.current = true;
        lastUVRef.current = null; 
        distanceAccumulatorRef.current = 0;
        
        // Extract pressure or default to 1.0
        let p = e.nativeEvent.pressure;
        if ((!p || p === 0) && e.nativeEvent.pointerType === 'mouse') p = 1.0;
        if (p === 0) p = 1.0; // Fallback for devices reporting 0 on start

        paintStroke(e.uv, p);
        (e.nativeEvent.target as HTMLElement).setPointerCapture(e.pointerId);
     }
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
     if (isAltPressed) return;
     if (gizmoDragging) return;

     if (brush.mode === 'curve') {
         if (draggingCurveIdx !== null && e.point) {
             const p = e.point.clone().normalize().multiplyScalar(2.0);
             updateCurvePoint(draggingCurveIdx, p);
         }
         return;
     }

     if (isPaintingRef.current && !isInteractingWithStencil && !isStencilEditMode && e.uv) {
        let p = e.nativeEvent.pressure;
        if ((!p || p === 0) && e.nativeEvent.pointerType === 'mouse') p = 1.0;
        
        paintStroke(e.uv, p);
     }
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
     if (draggingCurveIdx !== null) {
         setDraggingCurveIdx(null);
         return;
     }

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
        <meshStandardMaterial map={compositeTexture} roughness={0.5} metalness={0.1} transparent={true} side={THREE.DoubleSide} />
      </mesh>

      {/* Curve Overlay */}
      {brush.mode === 'curve' && curvePoints && (
          <BezierCurve 
            points={curvePoints} 
            onPointDown={(idx) => setDraggingCurveIdx(idx)} 
          />
      )}

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
