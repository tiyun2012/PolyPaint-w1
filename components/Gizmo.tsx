import React, { useEffect, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GizmoRenderer, GizmoHoverAxis, GizmoMode } from '../services/GizmoRenderer';
import { Vec3Utils, RayUtils, Vec3, Mat4Utils, QuatUtils, MathUtils } from '../services/math';

interface GizmoProps {
  target?: THREE.Object3D | null;
  position?: Vec3; // Optional explicit position (if target is null)
  rotation?: THREE.Euler | THREE.Quaternion; // Optional explicit rotation
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDrag?: () => void;
  mode?: GizmoMode;
  onModeChange?: (mode: GizmoMode) => void;
}

export const Gizmo: React.FC<GizmoProps> = ({ 
  target, 
  position, 
  rotation,
  onDragStart, 
  onDragEnd, 
  onDrag, 
  mode = 'translate',
  onModeChange
}) => {
  const { gl, camera, raycaster } = useThree();
  const rendererRef = useRef<GizmoRenderer | null>(null);
  
  // Interaction State
  const [hoverAxis, setHoverAxis] = useState<GizmoHoverAxis>(null);
  const [activeAxis, setActiveAxis] = useState<GizmoHoverAxis>(null);
  
  // Drag State
  const dragStartPoint = useRef<Vec3>({x:0, y:0, z:0});
  const dragStartTargetPos = useRef<Vec3>({x:0, y:0, z:0});
  const dragStartTargetRot = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const dragStartTargetScale = useRef<Vec3>({x:1, y:1, z:1});
  const dragStartAngle = useRef<number>(0);
  
  // Cache for rotation matrix to pass to renderer (Float32Array)
  const rotationMatrixRef = useRef<Float32Array>(new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]));
  const threeMatrix = useRef(new THREE.Matrix4());
  const threeQuaternion = useRef(new THREE.Quaternion());

  // Initialize Gizmo Renderer once
  useEffect(() => {
    if (!rendererRef.current) {
        const renderer = new GizmoRenderer();
        const ctx = gl.getContext();
        if (ctx instanceof WebGL2RenderingContext) {
            renderer.init(ctx);
            rendererRef.current = renderer;
        } else {
            console.error("GizmoRenderer requires WebGL 2");
        }
    }
    // Cleanup on unmount
    return () => {
        if (rendererRef.current) {
            rendererRef.current.dispose();
            rendererRef.current = null;
        }
    };
  }, [gl]);

  // Helper to get current transforms
  const getTransform = () => {
      const pos = {x:0, y:0, z:0};
      const rot = threeQuaternion.current.identity();
      const scl = {x:1, y:1, z:1};
      
      if (target) {
          pos.x = target.position.x;
          pos.y = target.position.y;
          pos.z = target.position.z;
          rot.copy(target.quaternion);
          scl.x = target.scale.x;
          scl.y = target.scale.y;
          scl.z = target.scale.z;
      } else if (position) {
          pos.x = position.x;
          pos.y = position.y;
          pos.z = position.z;
          
          if (rotation) {
             if (rotation instanceof THREE.Euler) rot.setFromEuler(rotation);
             else rot.copy(rotation as THREE.Quaternion);
          }
      }
      return { pos, rot, scl };
  };

  // Helper: Rotate vector by current gizmo rotation
  const applyRotation = (v: Vec3, rot: THREE.Quaternion): Vec3 => {
      const vec = new THREE.Vector3(v.x, v.y, v.z);
      vec.applyQuaternion(rot);
      return { x: vec.x, y: vec.y, z: vec.z };
  };

  // Helper Math
  const getAxisDir = (axis: string, rot: THREE.Quaternion): Vec3 => {
      if (axis === 'X') return applyRotation({x:1, y:0, z:0}, rot);
      if (axis === 'Y') return applyRotation({x:0, y:1, z:0}, rot);
      return applyRotation({x:0, y:0, z:1}, rot); // Z
  };

  const getPlaneNormal = (axis: string, rot: THREE.Quaternion): Vec3 => {
      // For translation/scale planes
      if (axis === 'XY') return applyRotation({x:0, y:0, z:1}, rot);
      if (axis === 'XZ') return applyRotation({x:0, y:1, z:0}, rot);
      if (axis === 'YZ') return applyRotation({x:1, y:0, z:0}, rot);

      // For rotation rings: The normal is the axis itself
      if (axis === 'X') return applyRotation({x:1, y:0, z:0}, rot); // Ring in YZ plane
      if (axis === 'Y') return applyRotation({x:0, y:1, z:0}, rot); // Ring in XZ plane
      if (axis === 'Z') return applyRotation({x:0, y:0, z:1}, rot); // Ring in XY plane
      
      return {x:0,y:1,z:0};
  };

  const getRotationAngle = (hitPoint: Vec3, center: Vec3, axis: string, rot: THREE.Quaternion): number => {
      const localP = new THREE.Vector3(hitPoint.x, hitPoint.y, hitPoint.z).sub(new THREE.Vector3(center.x, center.y, center.z));
      localP.applyQuaternion(rot.clone().invert());
      if (axis === 'X') return Math.atan2(localP.z, localP.y);
      else if (axis === 'Y') return Math.atan2(localP.x, localP.z);
      else return Math.atan2(localP.y, localP.x);
  };

  // Handle Pointer Events
  useEffect(() => {
      const canvas = gl.domElement;
      
      const onPointerDown = (e: PointerEvent) => {
          if (hoverAxis) {
              e.stopPropagation();
              e.preventDefault();
              canvas.setPointerCapture(e.pointerId);
              
              if (hoverAxis === 'SWITCH') {
                  if (onModeChange) {
                      const modes: GizmoMode[] = ['translate', 'rotate', 'scale'];
                      const idx = modes.indexOf(mode);
                      onModeChange(modes[(idx + 1) % 3]);
                  }
                  return; 
              }

              setActiveAxis(hoverAxis);
              onDragStart?.();
              
              const { pos, rot, scl } = getTransform();

              const rayDir = { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z };
              const rayOrigin = { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z };
              
              Vec3Utils.copy(dragStartTargetPos.current, pos);
              dragStartTargetRot.current.copy(rot);
              Vec3Utils.copy(dragStartTargetScale.current, scl);

              if (mode === 'translate' || mode === 'scale') {
                  if (hoverAxis.length === 1) { // X, Y, Z (Lines/Stems)
                     const axisDir = getAxisDir(hoverAxis, rot);
                     const closest = RayUtils.closestPointsRayRay(rayOrigin, rayDir, pos, axisDir);
                     if (closest) {
                         dragStartPoint.current = { x: closest.t2, y: 0, z: 0 }; 
                     }
                  } else if (hoverAxis.length === 2) { // Plane
                      const planeNormal = getPlaneNormal(hoverAxis, rot);
                      const t = RayUtils.intersectPlane(
                          { origin: rayOrigin, direction: rayDir }, 
                          { normal: planeNormal, distance: -Vec3Utils.dot(pos, planeNormal) }
                      );
                      if (t !== null) {
                          const hit = Vec3Utils.scaleAndAdd(rayOrigin, rayDir, t, Vec3Utils.create());
                          Vec3Utils.copy(dragStartPoint.current, hit);
                          
                          if (mode === 'scale') {
                             // Store initial distance from center for planar scale ratio
                             dragStartPoint.current.x = Vec3Utils.distance(hit, pos);
                          }
                      }
                  } else if (hoverAxis === 'VIEW') { // Scale uniform (center sphere/cube)
                      const planeNormal = { x: camera.getWorldDirection(new THREE.Vector3()).x, y: camera.getWorldDirection(new THREE.Vector3()).y, z: camera.getWorldDirection(new THREE.Vector3()).z };
                      const t = RayUtils.intersectPlane(
                        { origin: rayOrigin, direction: rayDir },
                        { normal: planeNormal, distance: -Vec3Utils.dot(pos, planeNormal) }
                      );
                      if (t !== null) {
                          const hit = Vec3Utils.scaleAndAdd(rayOrigin, rayDir, t, Vec3Utils.create());
                          dragStartPoint.current = hit;
                          dragStartPoint.current.x = Vec3Utils.distance(hit, pos); 
                      }
                  }
              } else if (mode === 'rotate') {
                  if (hoverAxis.length === 1) { 
                      const planeNormal = getPlaneNormal(hoverAxis, rot);
                      const t = RayUtils.intersectPlane(
                         { origin: rayOrigin, direction: rayDir },
                         { normal: planeNormal, distance: -Vec3Utils.dot(pos, planeNormal) }
                      );
                      if (t !== null) {
                          const hit = Vec3Utils.scaleAndAdd(rayOrigin, rayDir, t, Vec3Utils.create());
                          dragStartAngle.current = getRotationAngle(hit, pos, hoverAxis, rot);
                      }
                  }
              }
          }
      };

      const onPointerUp = (e: PointerEvent) => {
          if (activeAxis) {
              e.stopPropagation();
              e.preventDefault();
              canvas.releasePointerCapture(e.pointerId);
              setActiveAxis(null);
              onDragEnd?.();
          }
      };
      
      const onPointerMove = (e: PointerEvent) => {
          const { pos, rot } = getTransform();

          if (activeAxis) {
             const rayDir = { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z };
             const rayOrigin = { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z };
             
             if (mode === 'translate') {
                 const startPos = dragStartTargetPos.current;
                 let newPos = Vec3Utils.clone(startPos);

                 if (activeAxis.length === 1) {
                     const axisDir = getAxisDir(activeAxis, rot);
                     const closest = RayUtils.closestPointsRayRay(rayOrigin, rayDir, startPos, axisDir);
                     if (closest) {
                         const delta = closest.t2 - dragStartPoint.current.x;
                         Vec3Utils.scaleAndAdd(startPos, axisDir, delta, newPos);
                     }
                 } else if (activeAxis.length === 2 || activeAxis === 'VIEW') {
                     let planeNormal = {x:0, y:0, z:0};
                     if (activeAxis === 'VIEW') {
                         const dir = new THREE.Vector3();
                         camera.getWorldDirection(dir);
                         planeNormal = { x: dir.x, y: dir.y, z: dir.z };
                     } else {
                         planeNormal = getPlaneNormal(activeAxis, rot);
                     }

                     const t = RayUtils.intersectPlane(
                        { origin: rayOrigin, direction: rayDir },
                        { normal: planeNormal, distance: -Vec3Utils.dot(startPos, planeNormal) }
                     );
                     
                     if (t !== null) {
                         const currentHit = Vec3Utils.scaleAndAdd(rayOrigin, rayDir, t, Vec3Utils.create());
                         const delta = Vec3Utils.subtract(currentHit, dragStartPoint.current, Vec3Utils.create());
                         Vec3Utils.add(startPos, delta, newPos);
                     }
                 }
                 if (target) { target.position.set(newPos.x, newPos.y, newPos.z); target.updateMatrixWorld(); }

             } else if (mode === 'scale') {
                 if (!target) return;
                 const startScale = dragStartTargetScale.current;
                 
                 if (activeAxis.length === 1) { // 1 Axis Scale
                     const axisDir = getAxisDir(activeAxis, rot);
                     const closest = RayUtils.closestPointsRayRay(rayOrigin, rayDir, pos, axisDir);
                     if (closest) {
                         const dist = closest.t2; 
                         const startDist = dragStartPoint.current.x;
                         
                         const delta = (dist - startDist) * 1.0; 
                         const scaleFactor = 1 + delta; 
                         
                         if (activeAxis === 'X') target.scale.set(startScale.x * scaleFactor, startScale.y, startScale.z);
                         if (activeAxis === 'Y') target.scale.set(startScale.x, startScale.y * scaleFactor, startScale.z);
                         if (activeAxis === 'Z') target.scale.set(startScale.x, startScale.y, startScale.z * scaleFactor);
                     }
                 } else if (activeAxis.length === 2) { // Plane Scale (2-axis)
                     const planeNormal = getPlaneNormal(activeAxis, rot);
                     const t = RayUtils.intersectPlane(
                         { origin: rayOrigin, direction: rayDir }, 
                         { normal: planeNormal, distance: -Vec3Utils.dot(pos, planeNormal) }
                     );
                     
                     if (t !== null) {
                         const currentHit = Vec3Utils.scaleAndAdd(rayOrigin, rayDir, t, Vec3Utils.create());
                         const currentDist = Vec3Utils.distance(currentHit, pos);
                         const startDist = dragStartPoint.current.x; // stored in x
                         
                         if (startDist > 0) {
                             const ratio = currentDist / startDist;
                             
                             if (activeAxis === 'YZ') target.scale.set(startScale.x, startScale.y * ratio, startScale.z * ratio);
                             if (activeAxis === 'XZ') target.scale.set(startScale.x * ratio, startScale.y, startScale.z * ratio);
                             if (activeAxis === 'XY') target.scale.set(startScale.x * ratio, startScale.y * ratio, startScale.z);
                         }
                     }
                 } else if (activeAxis === 'VIEW') { // Uniform
                     // Project onto view plane, get distance from center
                     const planeNormal = { x: camera.getWorldDirection(new THREE.Vector3()).x, y: camera.getWorldDirection(new THREE.Vector3()).y, z: camera.getWorldDirection(new THREE.Vector3()).z };
                     const t = RayUtils.intersectPlane({ origin: rayOrigin, direction: rayDir }, { normal: planeNormal, distance: -Vec3Utils.dot(pos, planeNormal) });
                     if (t !== null) {
                         const hit = Vec3Utils.scaleAndAdd(rayOrigin, rayDir, t, Vec3Utils.create());
                         const currentDist = Vec3Utils.distance(hit, pos);
                         const startDist = dragStartPoint.current.x; // Recovered from storage
                         
                         if (startDist > 0) {
                            const ratio = currentDist / startDist;
                            target.scale.set(startScale.x * ratio, startScale.y * ratio, startScale.z * ratio);
                         }
                     }
                 }
                 target.updateMatrixWorld();

             } else if (mode === 'rotate') {
                 if (activeAxis.length === 1) {
                     const currentAxisDir = getAxisDir(activeAxis, rot);
                     const t = RayUtils.intersectPlane(
                        { origin: rayOrigin, direction: rayDir },
                        { normal: currentAxisDir, distance: -Vec3Utils.dot(pos, currentAxisDir) }
                     );
                     
                     if (t !== null) {
                         const hit = Vec3Utils.scaleAndAdd(rayOrigin, rayDir, t, Vec3Utils.create());
                         const currentAngle = getRotationAngle(hit, pos, activeAxis, rot);
                         const deltaAngle = currentAngle - dragStartAngle.current;
                         
                         if (target) {
                             const axisVec = new THREE.Vector3();
                             if (activeAxis === 'X') axisVec.set(1,0,0);
                             if (activeAxis === 'Y') axisVec.set(0,1,0);
                             if (activeAxis === 'Z') axisVec.set(0,0,1);
                             
                             const q = new THREE.Quaternion().setFromAxisAngle(axisVec, deltaAngle);
                             target.quaternion.multiply(q);
                             target.updateMatrixWorld();
                             dragStartAngle.current = currentAngle;
                         }
                     }
                 }
             }
             onDrag?.();

          } else {
             // Hover Logic
             const cameraPos = new THREE.Vector3();
             camera.getWorldPosition(cameraPos);
             const dist = cameraPos.distanceTo(new THREE.Vector3(pos.x, pos.y, pos.z));
             const scale = dist * 0.15; 
             const ray = { origin: { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z }, direction: { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z } };
             
             const axis = getHoverAxis(ray, pos, rot, scale, mode);
             if (axis !== hoverAxis) setHoverAxis(axis);
          }
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointermove', onPointerMove);
      
      return () => {
          canvas.removeEventListener('pointerdown', onPointerDown);
          window.removeEventListener('pointerup', onPointerUp);
          canvas.removeEventListener('pointermove', onPointerMove);
      };
  }, [gl, hoverAxis, activeAxis, target, position, rotation, camera, raycaster, mode, onModeChange]);


  const getHoverAxis = (ray: {origin:Vec3, direction:Vec3}, pos: Vec3, rot: THREE.Quaternion, scale: number, mode: string): GizmoHoverAxis => {
      // 1. Check Center Sphere/Cube
      if (mode === 'scale') {
          // Check for Center Cube (Switch Handle style geometry but at center)
          if (RayUtils.intersectSphere(ray, pos, 0.1 * scale)) return 'VIEW'; // Simplified hit test
      } else {
          if (RayUtils.intersectSphere(ray, pos, 0.1 * scale)) return 'VIEW';
      }
      
      // Check Switch Handle (Cube at 0.35, 0.35, 0.35 offset)
      if (onModeChange) {
          const switchOffset = applyRotation({x:0.35, y:0.35, z:0.35}, rot); 
          const switchPos = Vec3Utils.scaleAndAdd(pos, switchOffset, scale, Vec3Utils.create());
          if (RayUtils.intersectSphere(ray, switchPos, 0.08 * scale)) return 'SWITCH';
      }

      let bestAxis: GizmoHoverAxis = null;
      let minDist = Infinity;
      const threshold = 0.1 * scale;

      if (mode === 'translate' || mode === 'scale') {
          // 2. Check Axes (Line Segments)
          const axes = [
            { id: 'X', dir: getAxisDir('X', rot) },
            { id: 'Y', dir: getAxisDir('Y', rot) },
            { id: 'Z', dir: getAxisDir('Z', rot) }
          ];

          for (let a of axes) {
             const end = Vec3Utils.scaleAndAdd(pos, a.dir, 1.0 * scale, Vec3Utils.create());
             const d = RayUtils.distRaySegment(ray, pos, end);
             if (d < threshold && d < minDist) {
                 minDist = d;
                 bestAxis = a.id as GizmoHoverAxis;
             }
          }
          
          if (bestAxis) return bestAxis;

          // 3. Check Planes (Small Quads near origin)
          const planeSize = 0.25 * scale; 
          
          const checkPlane = (normal: Vec3, uDir: Vec3, vDir: Vec3, id: GizmoHoverAxis) => {
              const t = RayUtils.intersectPlane(ray, { normal, distance: -Vec3Utils.dot(pos, normal) });
              if (t !== null && t > 0) {
                  const hit = Vec3Utils.scaleAndAdd(ray.origin, ray.direction, t, Vec3Utils.create());
                  const localHit = Vec3Utils.subtract(hit, pos, Vec3Utils.create());
                  
                  const u = Vec3Utils.dot(localHit, uDir);
                  const v = Vec3Utils.dot(localHit, vDir);
                  
                  if (u > 0 && u < planeSize && v > 0 && v < planeSize) {
                      return true;
                  }
              }
              return false;
          };

          // Transform plane basis vectors
          const xDir = getAxisDir('X', rot);
          const yDir = getAxisDir('Y', rot);
          const zDir = getAxisDir('Z', rot);

          if (checkPlane(xDir, yDir, zDir, 'YZ')) return 'YZ';
          if (checkPlane(yDir, xDir, zDir, 'XZ')) return 'XZ';
          if (checkPlane(zDir, xDir, yDir, 'XY')) return 'XY';
      
      } else if (mode === 'rotate') {
          // Check Rings
          const ringRadius = 0.8 * scale;
          const ringThreshold = 0.1 * scale; // How thick is the grab area

          const checkRing = (normal: Vec3, id: GizmoHoverAxis) => {
              const t = RayUtils.intersectPlane(ray, { normal, distance: -Vec3Utils.dot(pos, normal) });
              if (t !== null && t > 0) {
                  const hit = Vec3Utils.scaleAndAdd(ray.origin, ray.direction, t, Vec3Utils.create());
                  const dist = Vec3Utils.distance(hit, pos);
                  if (Math.abs(dist - ringRadius) < ringThreshold) {
                      return t; // Return distance to camera
                  }
              }
              return Infinity;
          };

          const xDir = getAxisDir('X', rot);
          const yDir = getAxisDir('Y', rot);
          const zDir = getAxisDir('Z', rot);

          // X-Ring (Normal is X)
          const dx = checkRing(xDir, 'X');
          if (dx < minDist) { minDist = dx; bestAxis = 'X'; }
          
          // Y-Ring (Normal is Y)
          const dy = checkRing(yDir, 'Y');
          if (dy < minDist) { minDist = dy; bestAxis = 'Y'; }

          // Z-Ring (Normal is Z)
          const dz = checkRing(zDir, 'Z');
          if (dz < minDist) { minDist = dz; bestAxis = 'Z'; }
      }

      return bestAxis;
  }

  // Render Loop
  useFrame(() => {
     if ((!target && !position) || !rendererRef.current) return;

     const { pos, rot, scl } = getTransform();

     const cameraPos = new THREE.Vector3();
     camera.getWorldPosition(cameraPos);
     const dist = cameraPos.distanceTo(new THREE.Vector3(pos.x, pos.y, pos.z));
     const scale = dist * 0.15;

     // Calculate Matrix for Renderer
     threeMatrix.current.makeRotationFromQuaternion(rot);
     threeMatrix.current.toArray(rotationMatrixRef.current);

     const viewMatrix = new Float32Array(camera.matrixWorldInverse.elements);
     const projMatrix = new Float32Array(camera.projectionMatrix.elements);
     const vp = Mat4Utils.multiply(projMatrix, viewMatrix, new Float32Array(16));

     rendererRef.current.renderGizmos(
         vp,
         pos,
         rotationMatrixRef.current,
         scale,
         hoverAxis,
         activeAxis,
         mode,
         !!onModeChange
     );
  }, 1);

  return null;
};