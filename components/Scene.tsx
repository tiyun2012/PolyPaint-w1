import React, { useRef, useMemo, useEffect, useState, useCallback, useImperativeHandle, forwardRef, Suspense } from 'react';
import { Canvas, useThree, useFrame, createPortal, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Environment, useCursor, TransformControls, useTexture, Line } from '@react-three/drei';
import * as THREE from 'three';
import { BrushSettings, Layer, StencilSettings } from '../types';
import { TEXTURE_SIZE } from '../constants';
import { Vec3, Vec3Utils, Vec2, Vec2Utils, TMP_VEC2_1 } from '../services/math';
import { BrushAPI } from '../services/brushService';
import { StencilAPI } from '../services/stencilService';
import { eventBus, Events } from '../services/eventBus';

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
  const meshRef = useRef<THREE.Mesh>(null!);
  const proxyRef = useRef<THREE.Group>(null!); 
  
  useImperativeHandle(ref, () => groupRef.current);

  // ------------------------------------------------------------------
  // GRID STATE
  // ------------------------------------------------------------------
  const [gridPoints, setGridPoints] = useState<Vec3[][]>(() => {
    // Initial 2x2 grid. Order: Bottom Row (v=0) to Top Row (v=1)
    return [
      [Vec3Utils.create(-0.5 * aspectRatio, -0.5, 0), Vec3Utils.create(0.5 * aspectRatio, -0.5, 0)], // Bottom
      [Vec3Utils.create(-0.5 * aspectRatio, 0.5, 0), Vec3Utils.create(0.5 * aspectRatio, 0.5, 0)]   // Top
    ];
  });
  
  const [selectedPoint, setSelectedPoint] = useState<{r: number, c: number} | null>(null);
  const [hoverLoop, setHoverLoop] = useState<{ type: 'row' | 'col', value: number } | null>(null);

  // ------------------------------------------------------------------
  // LUT GENERATION RESOURCES
  // ------------------------------------------------------------------
  // Increased LUT Size to 1024 for smoother curve mapping
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
  const geometry = useMemo(() => {
     const geo = new THREE.BufferGeometry();
     
     const vertexCount = rowCuts.length * colCuts.length;
     const positions = new Float32Array(vertexCount * 3);
     const uvs = new Float32Array(vertexCount * 2);
     const indices: number[] = [];
     
     for (let r = 0; r < rowCuts.length - 1; r++) {
       for (let c = 0; c < colCuts.length - 1; c++) {
          const iBL = r * colCuts.length + c;
          const iBR = r * colCuts.length + (c + 1);
          const iTL = (r + 1) * colCuts.length + c;
          const iTR = (r + 1) * colCuts.length + (c + 1);
          
          indices.push(iBL, iBR, iTL);
          indices.push(iBR, iTR, iTL);
       }
     }
     
     geo.setIndex(indices);
     geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
     geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
     
     return geo;
  }, [rowCuts.length, colCuts.length]);

  // ------------------------------------------------------------------
  // QUAD WIREFRAME GEOMETRY (Visual Only)
  // ------------------------------------------------------------------
  const wireframeGeometry = useMemo(() => {
      const positions: number[] = [];
      const rows = gridPoints.length;
      if (rows === 0) return new THREE.BufferGeometry();
      const cols = gridPoints[0].length;

      // Horizontal Lines (Rows)
      for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols - 1; c++) {
              positions.push(gridPoints[r][c].x, gridPoints[r][c].y, 0);
              positions.push(gridPoints[r][c+1].x, gridPoints[r][c+1].y, 0);
          }
      }

      // Vertical Lines (Cols)
      for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows - 1; r++) {
              positions.push(gridPoints[r][c].x, gridPoints[r][c].y, 0);
              positions.push(gridPoints[r+1][c].x, gridPoints[r+1][c].y, 0);
          }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      return geo;
  }, [gridPoints]);

  // ------------------------------------------------------------------
  // PREVIEW LOOP CURVE CALCULATION
  // ------------------------------------------------------------------
  const previewLoopPoints = useMemo(() => {
      if (!hoverLoop) return null;
      const { type, value } = hoverLoop;
      const points: Vec3[] = [];

      if (type === 'row') {
          // Find where this V falls
          let insertIndex = 0;
          while (insertIndex < rowCuts.length && rowCuts[insertIndex] < value) insertIndex++;
          const prevRowIdx = Math.max(0, insertIndex - 1);
          const nextRowIdx = Math.min(rowCuts.length - 1, insertIndex);
          const vPrev = rowCuts[prevRowIdx];
          const vNext = rowCuts[nextRowIdx];
          
          let t = 0.5;
          if (vNext > vPrev) t = (value - vPrev) / (vNext - vPrev);

          // Interpolate across all columns to get a curve
          const cols = gridPoints[0].length;
          for (let c = 0; c < cols; c++) {
              const pA = gridPoints[prevRowIdx][c];
              const pB = gridPoints[nextRowIdx][c];
              const p = Vec3Utils.lerp(pA, pB, t, Vec3Utils.create());
              p.z = 0.05; // Slightly in front
              points.push(p);
          }

      } else {
          // Col cut
          let insertIndex = 0;
          while (insertIndex < colCuts.length && colCuts[insertIndex] < value) insertIndex++;
          const prevColIdx = Math.max(0, insertIndex - 1);
          const nextColIdx = Math.min(colCuts.length - 1, insertIndex);
          const uPrev = colCuts[prevColIdx];
          const uNext = colCuts[nextColIdx];
          
          let t = 0.5;
          if (uNext > uPrev) t = (value - uPrev) / (uNext - uPrev);

          const rows = gridPoints.length;
          for (let r = 0; r < rows; r++) {
              const pA = gridPoints[r][prevColIdx];
              const pB = gridPoints[r][nextColIdx];
              const p = Vec3Utils.lerp(pA, pB, t, Vec3Utils.create());
              p.z = 0.05;
              points.push(p);
          }
      }
      return points;
  }, [hoverLoop, gridPoints, rowCuts, colCuts]);

  // ------------------------------------------------------------------
  // LOOP ADDITION LOGIC
  // ------------------------------------------------------------------
  const handleInternalAddLoop = (type: 'row' | 'col', val: number) => {
      const newPoints = gridPoints.map(row => row.map(v => Vec3Utils.clone(v)));
      
      if (type === 'row') {
          let insertIndex = 0;
          while (insertIndex < rowCuts.length && rowCuts[insertIndex] < val) {
              insertIndex++;
          }
          
          const prevRowIdx = Math.max(0, insertIndex - 1);
          const nextRowIdx = Math.min(rowCuts.length - 1, insertIndex);
          const vPrev = rowCuts[prevRowIdx];
          const vNext = rowCuts[nextRowIdx];
          
          let t = 0.5;
          if (vNext > vPrev) {
             t = (val - vPrev) / (vNext - vPrev);
          }
          
          const newRowPoints: Vec3[] = [];
          for (let c = 0; c < colCuts.length; c++) {
              const pA = gridPoints[prevRowIdx][c];
              const pB = gridPoints[nextRowIdx][c];
              if (pA && pB) {
                const interpolated = Vec3Utils.lerp(pA, pB, t, Vec3Utils.create());
                newRowPoints.push(interpolated);
              } else {
                 newRowPoints.push(Vec3Utils.create()); 
              }
          }
          newPoints.splice(insertIndex, 0, newRowPoints);
      } else {
          let insertIndex = 0;
          while (insertIndex < colCuts.length && colCuts[insertIndex] < val) {
              insertIndex++;
          }
          const prevColIdx = Math.max(0, insertIndex - 1);
          const nextColIdx = Math.min(colCuts.length - 1, insertIndex);
          const uPrev = colCuts[prevColIdx];
          const uNext = colCuts[nextColIdx];
          
          let t = 0.5;
          if (uNext > uPrev) {
             t = (val - uPrev) / (uNext - uPrev);
          }
          
          for (let r = 0; r < gridPoints.length; r++) {
              const pA = gridPoints[r][prevColIdx];
              const pB = gridPoints[r][nextColIdx];
              if (pA && pB) {
                 const pNew = Vec3Utils.lerp(pA, pB, t, Vec3Utils.create());
                 newPoints[r].splice(insertIndex, 0, pNew);
              }
          }
      }
      setGridPoints(newPoints);
      onAddLoop(type, val);
  };

  // ------------------------------------------------------------------
  // UPDATE GEOMETRY & RENDER LUT
  // ------------------------------------------------------------------
  const isGeometryValid = gridPoints.length === rowCuts.length && gridPoints[0]?.length === colCuts.length;

  useEffect(() => {
     if (!isGeometryValid) return;

     const posAttr = geometry.attributes.position;
     const uvAttr = geometry.attributes.uv;
     
     // 1. Update Geometry Positions
     let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

     for (let r = 0; r < rowCuts.length; r++) {
       const v = rowCuts[r]; 
       for (let c = 0; c < colCuts.length; c++) {
          const u = colCuts[c];
          const index = r * colCuts.length + c;
          
          uvAttr.setXY(index, u, v);
          
          const p = gridPoints[r][c];
          posAttr.setXYZ(index, p.x, p.y, 0);
          
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
       }
     }
     
     posAttr.needsUpdate = true;
     uvAttr.needsUpdate = true;
     geometry.computeVertexNormals();

     // 2. Render LUT
     // We define a margin to ensure we capture points slightly dragged out
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

  }, [geometry, rowCuts, colCuts, gridPoints, isGeometryValid, gl, lutFBO, lutScene, lutCamera, lutMaterial, onLutUpdate]);

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

  const handleProxyChange = () => {
     if (selectedPoint !== null) {
        setGridPoints(prev => {
           const next = prev.map(row => row.map(v => Vec3Utils.clone(v)));
           const {r, c} = selectedPoint;
           const newPos = proxyRef.current.position; // Keep reading as THREE.Vector3 from TransformControls
           // Sync back to internal Vec3 state
           next[r][c] = Vec3Utils.create(newPos.x, newPos.y, 0);
           return next;
        });
     }
  };

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
      if (tool === 'select') setSelectedPoint(null); 
      else if (tool === 'loop' && hoverLoop) {
         handleInternalAddLoop(hoverLoop.type, hoverLoop.value);
         setHoverLoop(null);
      }
  };

  const innerContent = (
    <group ref={groupRef} position={[0, 0, 2.5]} onClick={handleClick} onPointerMove={handlePointerMove}>
       <mesh ref={meshRef} geometry={geometry}>
          <meshBasicMaterial 
             map={texture} 
             transparent={true} 
             opacity={opacity * 0.7} 
             side={THREE.DoubleSide}
             depthTest={false}
          />
       </mesh>

       {/* Quad Grid Lines (Visual Only) */}
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
               position={[pos.x, pos.y, pos.z]} // Convert internal Vec3 to [x,y,z] for R3F
               selected={selectedPoint?.r === r && selectedPoint?.c === c}
               onSelect={(e) => setSelectedPoint({r, c})}
               visible={true}
             />
           ))
       )}
       
       {/* Deformed Loop Hint */}
       {editable && tool === 'loop' && hoverLoop && previewLoopPoints && (
          <Line
             points={previewLoopPoints.map(p => [p.x, p.y, p.z])} // Convert Vec3[] to [x,y,z][]
             color={hoverLoop.type === 'row' ? 'yellow' : 'cyan'} 
             lineWidth={3} depthTest={false} renderOrder={9999}
          />
       )}
    </group>
  );

  if (editable && tool === 'select') {
     return (
       <>
         {innerContent}
         {selectedPoint !== null ? (
            <TransformControls 
               object={proxyRef.current} mode="translate" space="local" size={0.3}
               // @ts-ignore
               onDraggingChanged={(e: any) => onDragChange(e.value)} onChange={handleProxyChange}
            />
         ) : (
            <TransformControls 
               object={groupRef.current} mode={mode} space="local" size={0.6}
               // @ts-ignore
               onDraggingChanged={(e: any) => onDragChange(e.value)}
            />
         )}
       </>
     );
  }

  return innerContent;
});

// ------------------------------------------------------------------
// PROJECTION PREVIEW COMPONENT
// ------------------------------------------------------------------
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
         
         // Map localPos.xy to LUT UV
         vec2 lutUV = (localPos.xy - lutBounds.xy) / lutBounds.zw;
         
         // Discard if outside LUT/Grid Bounds
         if (lutUV.x < 0.0 || lutUV.x > 1.0 || lutUV.y < 0.0 || lutUV.y > 1.0) discard;
         
         // Sample LUT to get Stencil UV
         vec4 stencilMap = texture2D(lutTexture, lutUV);
         
         // Alpha 0 in LUT means empty space (if cleared to transparent)
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

// ------------------------------------------------------------------
// PROJECTION BAKER HELPER
// ------------------------------------------------------------------
const ProjectionBaker = forwardRef(({ stencil, meshGeometry, stencilObjectRef, lutTexture, lutBounds }: any, ref) => {
  const { gl } = useThree();
  // Using samples: 4 for MSAA if supported by browser/device
  const fbo = useMemo(() => new THREE.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, { samples: 4 }), []);
  const scene = useMemo(() => new THREE.Scene(), []);
  const camera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  
  // USE useTexture HERE. This ensures texture is loaded before baking.
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
             // More tolerant alpha check
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
     
     // Stencil texture already loaded by useTexture
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

  useImperativeHandle(ref, () => ({
    bake: triggerBake
  }));

  return null;
});

// ------------------------------------------------------------------
// PAINTABLE MESH COMPONENT
// ------------------------------------------------------------------
const PaintableMesh: React.FC<SceneProps & { setStencil?: (s: any) => void; isAltPressed: boolean }> = ({ 
  brush, layers, activeLayerId, stencil, setStencil, isAltPressed 
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHover] = useState(false);
  const [gizmoDragging, setGizmoDragging] = useState(false);
  
  // Paint State Refs (Performance: avoid React state for tight loops)
  const isPaintingRef = useRef(false);
  const lastUVRef = useRef<Vec2 | null>(null); // Use internal Vec2
  const distanceAccumulatorRef = useRef(0);
  const compositeDirtyRef = useRef(false);

  const isInteractingWithStencil = gizmoDragging;
  const isStencilEditMode = stencil.visible && stencil.mode === 'edit';

  const stencilMeshRef = useRef<THREE.Group>(null);
  const bakerRef = useRef<any>(null);
  
  // LUT STATE
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

  // Event Listeners for Scene Actions
  useEffect(() => {
    // Listener for Baking
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
        
        // Notify that we need a redraw
        compositeDirtyRef.current = true;
    };

    // Listener for Composite Update (e.g. from LayerManager)
    const handleCompositeUpdate = () => {
        compositeDirtyRef.current = true;
    };

    const unsubBake = eventBus.on(Events.REQ_BAKE_PROJECTION, handleBakeRequest);
    const unsubComp = eventBus.on(Events.REFRESH_COMPOSITE, handleCompositeUpdate);

    return () => {
        unsubBake();
        unsubComp();
    };
  }, [layers]); // Re-bind when layers array changes to ensure closure has latest layers

  // Trigger composite update when active layer changes or layers are reordered (structural changes handled by React render)
  useEffect(() => { compositeDirtyRef.current = true; }, [layers]);

  // Composite Texture (The Display Texture)
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
  
  // High Performance Loop for Texture Updates
  // Instead of updating the texture on every mouse move (can be hundreds/sec),
  // we update it once per frame maximum.
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

  // Brush Resources
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  useEffect(() => {
     if (brush.maskImage) {
        BrushAPI.processMaskTip(brush.maskImage).then(mask => {
            maskCanvasRef.current = mask;
        });
     } else { 
        maskCanvasRef.current = null; 
     }
  }, [brush.maskImage]);

  // ------------------------------------------------------------------
  // DRAW STAMP (Single Brush Splat)
  // ------------------------------------------------------------------
  const drawStamp = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number) => {
      const size = brush.size;
      const radius = size / 2;
      
      // Jitter calculations
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
      
      // Transform for rotation
      ctx.translate(posX, posY);
      ctx.rotate(angle);
      // Move back to handle draw offset
      ctx.translate(-posX, -posY);

      ctx.globalAlpha = brush.opacity * brush.flow;
      
      if (brush.mode === 'erase') {
         ctx.globalCompositeOperation = 'destination-out';
      } else {
         ctx.globalCompositeOperation = 'source-over';
      }
      
      const drawX = posX - radius;
      const drawY = posY - radius;

      if (maskCanvasRef.current) {
          const mask = maskCanvasRef.current;
          if (brush.mode === 'paint') {
              if (!tintCanvasRef.current) tintCanvasRef.current = document.createElement('canvas');
              const tCvs = tintCanvasRef.current;
              if (tCvs.width !== size || tCvs.height !== size) {
                  tCvs.width = size; tCvs.height = size;
              }
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
          // Use a circle for simple brush, but if rotated with scaling (future), need ellipse
          // Simple circle isn't affected by rotation unless we scale non-uniformly
          ctx.arc(posX, posY, radius, 0, Math.PI*2); 
          ctx.fill();
      }
      ctx.restore();
  }, [brush]);
  
  // ------------------------------------------------------------------
  // INTERPOLATED STROKE
  // ------------------------------------------------------------------
  const paintStroke = useCallback((uv: THREE.Vector2) => {
     const layer = layers.find(l => l.id === activeLayerId);
     if (!layer) return;

     const currentX = uv.x * TEXTURE_SIZE;
     const currentY = (1 - uv.y) * TEXTURE_SIZE;
     const currentVec = Vec2Utils.create(currentX, currentY);

     if (!lastUVRef.current) {
        // First point of stroke
        drawStamp(layer.ctx, currentX, currentY);
        lastUVRef.current = currentVec;
        compositeDirtyRef.current = true;
        return;
     }

     const dist = Vec2Utils.distance(lastUVRef.current, currentVec);
     const stepSize = Math.max(1, brush.size * brush.spacing);
     
     // Add distance to accumulator
     distanceAccumulatorRef.current += dist;

     // While we have enough distance to take a step
     while (distanceAccumulatorRef.current >= stepSize) {
        // Move towards current
        // TMP_VEC2_1: direction
        Vec2Utils.subtract(currentVec, lastUVRef.current!, TMP_VEC2_1);
        Vec2Utils.normalize(TMP_VEC2_1, TMP_VEC2_1);
        
        // Scale direction by stepSize (reuse TMP_VEC2_1)
        Vec2Utils.scale(TMP_VEC2_1, stepSize, TMP_VEC2_1);

        // Next Pos
        const nextPos = Vec2Utils.create(); // Create new vec2 to store path
        Vec2Utils.add(lastUVRef.current!, TMP_VEC2_1, nextPos);
        
        drawStamp(layer.ctx, nextPos.x, nextPos.y);
        
        lastUVRef.current = nextPos;
        distanceAccumulatorRef.current -= stepSize;
     }
     
     compositeDirtyRef.current = true;
  }, [activeLayerId, layers, drawStamp, brush.spacing, brush.size]);

  // Pointer Handlers
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
     if (isAltPressed) return;
     if (!isInteractingWithStencil && !isStencilEditMode && e.uv) {
        eventBus.emit(Events.PAINT_START, { layerId: activeLayerId, tool: brush.mode, uv: e.uv });
        isPaintingRef.current = true;
        lastUVRef.current = null; // Reset stroke
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

      {/* STENCIL PROJECTION UI */}
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
      
      <PaintableMesh {...props} isAltPressed={isAltPressed} />
    </Canvas>
  );
};

export default Scene;