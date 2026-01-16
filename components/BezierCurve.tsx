
import React, { useMemo } from 'react';
import { Line, Billboard } from '@react-three/drei';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Vec3 } from '../types';

interface BezierCurveProps {
  points: Vec3[];
  onPointDown: (index: number, e: ThreeEvent<PointerEvent>) => void;
}

export const BezierCurve: React.FC<BezierCurveProps> = ({ points, onPointDown }) => {
    const path = useMemo(() => {
        if (points.length < 2) return null;
        const curvePath = new THREE.CurvePath<THREE.Vector3>();
        const offset = 0.05; 
        const project = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z).normalize().multiplyScalar(2.0 + offset);

        for (let i = 0; i < points.length - 3; i += 3) {
            curvePath.add(new THREE.CubicBezierCurve3(
                project(points[i]),
                project(points[i+1]),
                project(points[i+2]),
                project(points[i+3])
            ));
        }
        return curvePath;
    }, [points]);

    const linePoints = useMemo(() => {
        if (!path || path.curves.length === 0) return null;
        return path.getPoints(Math.max(100, path.curves.length * 50));
    }, [path]);
    
    // Visualize Controls
    const handles = useMemo(() => {
        return points.map((p, i) => {
             const isAnchor = i % 3 === 0;
             const pos = new THREE.Vector3(p.x, p.y, p.z).normalize().multiplyScalar(2.0 + 0.05);
             
             return (
                 <Billboard 
                   key={i} 
                   position={pos} 
                 >
                     {/* Visible Handle Geometry */}
                     <mesh
                       onClick={(e) => e.stopPropagation()}
                       onPointerDown={(e) => { e.stopPropagation(); onPointDown(i, e); }}
                       renderOrder={9999}
                     >
                        {isAnchor ? (
                            // Anchor: Hollow Ring ("Circle Edge")
                            <ringGeometry args={[0.018, 0.022, 32]} />
                        ) : (
                            // Tangent: Filled Dot - Thinner/Smaller (0.012 -> 0.008)
                            <circleGeometry args={[0.008, 16]} />
                        )}
                        <meshBasicMaterial 
                           color={isAnchor ? '#ffff00' : '#00ffff'} 
                           depthTest={false} 
                           transparent 
                           side={THREE.DoubleSide}
                        />
                     </mesh>

                     {/* Invisible Hit Area (Larger for usability) */}
                     <mesh
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => { e.stopPropagation(); onPointDown(i, e); }}
                        visible={false}
                     >
                        <circleGeometry args={[0.03, 16]} />
                     </mesh>
                 </Billboard>
             );
        });
    }, [points, onPointDown]);

    // Visualize Control Lines
    const controlLines = useMemo(() => {
        const lines = [];
        const project = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z).normalize().multiplyScalar(2.05);
        for(let i=0; i < points.length - 1; i++) {
            // Draw lines between Anchor and its Control points
            if (i % 3 === 0 && i+1 < points.length) lines.push([project(points[i]), project(points[i+1])]); // Anchor -> Next Control
            if (i % 3 === 2 && i+1 < points.length) lines.push([project(points[i]), project(points[i+1])]); // Prev Control -> Anchor
        }
        return lines;
    }, [points]);

    return (
        <group>
            {linePoints && (
                <Line 
                    points={linePoints} 
                    color="white" 
                    lineWidth={0.8} 
                    depthTest={false} 
                    transparent 
                    opacity={0.8} 
                    renderOrder={9998}
                    dashed={true}
                    dashScale={20}
                    dashSize={0.2}
                    gapSize={0.1}
                />
            )}
            {handles}
            {controlLines.map((pts, i) => (
                <Line 
                    key={`cl-${i}`} 
                    points={pts} 
                    color="#444" 
                    lineWidth={0.5} 
                    depthTest={false} 
                    transparent 
                    opacity={0.5} 
                    dashed={true}
                    dashScale={20}
                    dashSize={0.1}
                    gapSize={0.1}
                    renderOrder={9998} 
                />
            ))}
        </group>
    );
};
