import React, { useEffect, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GizmoRenderer, GizmoHoverAxis } from '../services/GizmoRenderer';
import { Vec3Utils, RayUtils, Vec3, Mat4Utils } from '../services/math';

interface GizmoProps {
  target?: THREE.Object3D | null;
  position?: Vec3; // Optional explicit position (if target is null)
  rotation?: THREE.Euler | THREE.Quaternion; // Optional explicit rotation
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDrag?: () => void;
  mode?: 'translate' | 'scale' | 'rotate';
}

export const Gizmo: React.FC<GizmoProps> = ({ 
  target, 
  position, 
  rotation,
  onDragStart, 
  onDragEnd, 
  onDrag, 
  mode = 'translate' 
}) => {
  const { gl, camera, raycaster } = useThree();
  const rendererRef = useRef<GizmoRenderer | null>(null);
  
  // Interaction State
  const [hoverAxis, setHoverAxis] = useState<GizmoHoverAxis>(null);
  const [activeAxis, setActiveAxis] = useState<GizmoHoverAxis>(null);
  
  // Drag State
  const dragStartPoint = useRef<Vec3>({x:0, y:0, z:0});
  const dragStartTargetPos = useRef<Vec3>({x:0, y:0, z:0});
  
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
  }, [gl]);

  // Helper to get current transforms
  const getTransform = () => {
      const pos = {x:0, y:0, z:0};
      const rot = threeQuaternion.current.identity();
      
      if (target) {
          pos.x = target.position.x;
          pos.y = target.position.y;
          pos.z = target.position.z;
          rot.copy(target.quaternion);
      } else if (position) {
          pos.x = position.x;
          pos.y = position.y;
          pos.z = position.z;
          
          if (rotation) {
             if (rotation instanceof THREE.Euler) rot.setFromEuler(rotation);
             else rot.copy(rotation as THREE.Quaternion);
          }
      }
      return { pos, rot };
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
      if (axis === 'XY') return applyRotation({x:0, y:0, z:1}, rot);
      if (axis === 'XZ') return applyRotation({x:0, y:1, z:0}, rot);
      return applyRotation({x:1, y:0, z:0}, rot); // YZ
  };

  // Handle Pointer Events
  useEffect(() => {
      const canvas = gl.domElement;
      
      const onPointerDown = (e: PointerEvent) => {
          if (hoverAxis) {
              e.stopPropagation();
              e.preventDefault();
              canvas.setPointerCapture(e.pointerId);
              setActiveAxis(hoverAxis);
              onDragStart?.();
              
              const { pos, rot } = getTransform();

              const rayDir = { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z };
              const rayOrigin = { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z };
              
              Vec3Utils.copy(dragStartTargetPos.current, pos);

              // Setup drag start points based on axis
              if (hoverAxis.length === 1) { // X, Y, Z (Lines)
                 const axisDir = getAxisDir(hoverAxis, rot);
                 const closest = RayUtils.closestPointsRayRay(rayOrigin, rayDir, pos, axisDir);
                 if (closest) {
                     // Store the distance along the axis as the start value
                     dragStartPoint.current = { x: closest.t2, y: 0, z: 0 }; // We overload x to store t value
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
                  }
              } else if (hoverAxis === 'VIEW') {
                  // View plane drag (sphere) - Drag parallel to camera plane
                  const planeNormal = { x: camera.getWorldDirection(new THREE.Vector3()).x, y: camera.getWorldDirection(new THREE.Vector3()).y, z: camera.getWorldDirection(new THREE.Vector3()).z };
                  const t = RayUtils.intersectPlane(
                    { origin: rayOrigin, direction: rayDir },
                    { normal: planeNormal, distance: -Vec3Utils.dot(pos, planeNormal) }
                  );
                  if (t !== null) {
                      const hit = Vec3Utils.scaleAndAdd(rayOrigin, rayDir, t, Vec3Utils.create());
                      Vec3Utils.copy(dragStartPoint.current, hit);
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
             // Dragging Logic
             const rayDir = { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z };
             const rayOrigin = { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z };
             const startPos = dragStartTargetPos.current;

             let newPos = Vec3Utils.clone(startPos);

             if (activeAxis.length === 1) { // Linear Drag
                 const axisDir = getAxisDir(activeAxis, rot);
                 const closest = RayUtils.closestPointsRayRay(rayOrigin, rayDir, startPos, axisDir);
                 if (closest) {
                     const delta = closest.t2 - dragStartPoint.current.x;
                     Vec3Utils.scaleAndAdd(startPos, axisDir, delta, newPos);
                 }
             } else if (activeAxis.length === 2 || activeAxis === 'VIEW') { // Planar Drag
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

             // Update Target or allow API consumption of onDrag
             if (target) {
                 target.position.set(newPos.x, newPos.y, newPos.z);
                 target.updateMatrixWorld();
             }
             onDrag?.();

          } else {
             // Hover Logic
             const cameraPos = new THREE.Vector3();
             camera.getWorldPosition(cameraPos);
             const dist = cameraPos.distanceTo(new THREE.Vector3(pos.x, pos.y, pos.z));
             const scale = dist * 0.15; 
             const ray = { origin: { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z }, direction: { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z } };
             
             const axis = getHoverAxis(ray, pos, rot, scale);
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
  }, [gl, hoverAxis, activeAxis, target, position, rotation, camera, raycaster]);


  const getHoverAxis = (ray: {origin:Vec3, direction:Vec3}, pos: Vec3, rot: THREE.Quaternion, scale: number): GizmoHoverAxis => {
      // 1. Check Center Sphere
      if (RayUtils.intersectSphere(ray, pos, 0.1 * scale)) return 'VIEW';
      
      let bestAxis: GizmoHoverAxis = null;
      let minDist = Infinity;
      const threshold = 0.1 * scale;

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

      // YZ Plane (X-Normal)
      if (checkPlane(xDir, yDir, zDir, 'YZ')) return 'YZ';
      // XZ Plane (Y-Normal)
      if (checkPlane(yDir, xDir, zDir, 'XZ')) return 'XZ';
      // XY Plane (Z-Normal)
      if (checkPlane(zDir, xDir, yDir, 'XY')) return 'XY';

      return null;
  }

  // Render Loop
  useFrame(() => {
     if ((!target && !position) || !rendererRef.current) return;

     const { pos, rot } = getTransform();

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
         activeAxis
     );
  }, 1);

  return null;
};