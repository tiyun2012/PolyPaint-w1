export type GizmoHoverAxis = 'X' | 'Y' | 'Z' | 'XY' | 'XZ' | 'YZ' | 'VIEW' | 'SWITCH' | null;
export type GizmoMode = 'translate' | 'rotate' | 'scale';

type GizmoOffsets = {
    cylinder: number; cylinderCount: number;
    cone: number; coneCount: number;
    quad: number; quadCount: number;
    quadBorder: number; quadBorderCount: number;
    sphere: number; sphereCount: number;
    ring: number; ringCount: number;
    cube: number; cubeCount: number;
};

/**
 * Lightweight standalone gizmo renderer.
 * Optimized for WebGL 2 with zero garbage collection during render loop.
 */
export class GizmoRenderer {
    private gl: WebGL2RenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private vao: WebGLVertexArrayObject | null = null;
    private vbo: WebGLBuffer | null = null;
    private offsets: GizmoOffsets | null = null;

    // Pre-allocated matrices to avoid GC during render loop
    private mBase = new Float32Array(16);
    private mScale = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); // Reused buffer
    private mRot = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);   // Reused buffer
    private mRS = new Float32Array(16);
    private mFinal = new Float32Array(16);
    private mPart = new Float32Array(16);
    private mTip = new Float32Array(16); // Temp for scale box calculation

    // Constant offsets
    private mTipOffset = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0.6,0,1]); // Y += 0.6
    private mSwitchOffset = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0.35,0.35,0.35,1]); // Offset for switch handle

    // Uniform Locations
    private locVP: WebGLUniformLocation | null = null;
    private locModel: WebGLUniformLocation | null = null;
    private locColor: WebGLUniformLocation | null = null;
    private locAlpha: WebGLUniformLocation | null = null;

    private createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
        const vs = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vs, vsSrc);
        gl.compileShader(vs);

        const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fs, fsSrc);
        gl.compileShader(fs);

        const prog = gl.createProgram()!;
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('GizmoRenderer link error', gl.getProgramInfoLog(prog));
            return null;
        }
        return prog;
    }

    init(gl: WebGL2RenderingContext) {
        if (this.gl) return;
        this.gl = gl;

        const vs = `#version 300 es
        layout(location=0) in vec3 a_pos;
        uniform mat4 u_vp;
        uniform mat4 u_model;
        void main() { gl_Position = u_vp * u_model * vec4(a_pos, 1.0); }`;

        const fs = `#version 300 es
        precision mediump float;
        uniform vec3 u_color;
        uniform float u_alpha;
        layout(location=0) out vec4 outColor;
        void main() { outColor = vec4(u_color, u_alpha); }`;

        this.program = this.createProgram(gl, vs, fs);
        if (!this.program) return;

        this.locVP = gl.getUniformLocation(this.program, 'u_vp');
        this.locModel = gl.getUniformLocation(this.program, 'u_model');
        this.locColor = gl.getUniformLocation(this.program, 'u_color');
        this.locAlpha = gl.getUniformLocation(this.program, 'u_alpha');

        const vertices: number[] = [];

        // --- Geometry Generation (Y-Up default) ---
        
        // 1. Cylinder (Arrow Stem)
        const stemLen = 0.6;
        const stemRad = 0.005;
        const segs = 16;
        for (let i = 0; i < segs; i++) {
            const th = (i / segs) * Math.PI * 2;
            const th2 = ((i + 1) / segs) * Math.PI * 2;
            const x1 = Math.cos(th) * stemRad, z1 = Math.sin(th) * stemRad;
            const x2 = Math.cos(th2) * stemRad, z2 = Math.sin(th2) * stemRad;
            vertices.push(x1, 0, z1, x2, 0, z2, x1, stemLen, z1);
            vertices.push(x2, 0, z2, x2, stemLen, z2, x1, stemLen, z1);
        }

        // 2. Cone (Arrow Tip)
        const tipStart = stemLen;
        const tipEnd = 0.67;
        const tipRad = 0.022;
        const coneOff = vertices.length / 3;
        for (let i = 0; i < segs; i++) {
            const th = (i / segs) * Math.PI * 2;
            const th2 = ((i + 1) / segs) * Math.PI * 2;
            const x1 = Math.cos(th) * tipRad, z1 = Math.sin(th) * tipRad;
            const x2 = Math.cos(th2) * tipRad, z2 = Math.sin(th2) * tipRad;
            vertices.push(x1, tipStart, z1, x2, tipStart, z2, 0, tipEnd, 0);
            vertices.push(x1, tipStart, z1, 0, tipStart, 0, x2, tipStart, z2);
        }

        // 3. Quad (Filled Plane)
        const quadOff = vertices.length / 3;
        const qS = 0.1, qO = 0.1;
        vertices.push(qO, qO, 0, qO + qS, qO, 0, qO, qO + qS, 0);
        vertices.push(qO + qS, qO, 0, qO + qS, qO + qS, 0, qO, qO + qS, 0);

        // 4. Quad Border
        const borderOff = vertices.length / 3;
        vertices.push(qO, qO, 0, qO + qS, qO, 0, qO + qS, qO + qS, 0, qO, qO + qS, 0);

        // 5. Sphere
        const sphereRad = 0.025;
        const sphereOff = vertices.length / 3;
        const lat = 8, lon = 12;
        for (let i = 0; i < lat; i++) {
            const th1 = (i / lat) * Math.PI;
            const th2 = ((i + 1) / lat) * Math.PI;
            for (let j = 0; j < lon; j++) {
                const ph1 = (j / lon) * 2 * Math.PI;
                const ph2 = ((j + 1) / lon) * 2 * Math.PI;
                const p1 = { x: Math.sin(th1) * Math.cos(ph1), y: Math.cos(th1), z: Math.sin(th1) * Math.sin(ph1) };
                const p2 = { x: Math.sin(th1) * Math.cos(ph2), y: Math.cos(th1), z: Math.sin(th1) * Math.sin(ph2) };
                const p3 = { x: Math.sin(th2) * Math.cos(ph1), y: Math.cos(th2), z: Math.sin(th2) * Math.sin(ph1) };
                const p4 = { x: Math.sin(th2) * Math.cos(ph2), y: Math.cos(th2), z: Math.sin(th2) * Math.sin(ph2) };
                vertices.push(
                    p1.x * sphereRad, p1.y * sphereRad, p1.z * sphereRad,
                    p3.x * sphereRad, p3.y * sphereRad, p3.z * sphereRad,
                    p2.x * sphereRad, p2.y * sphereRad, p2.z * sphereRad,
                );
                vertices.push(
                    p2.x * sphereRad, p2.y * sphereRad, p2.z * sphereRad,
                    p3.x * sphereRad, p3.y * sphereRad, p3.z * sphereRad,
                    p4.x * sphereRad, p4.y * sphereRad, p4.z * sphereRad,
                );
            }
        }

        // 6. Ring
        const ringRad = 0.8;
        const ringThick = 0.02; 
        const ringSegs = 64;
        const ringOff = vertices.length / 3;
        for (let i = 0; i < ringSegs; i++) {
            const th1 = (i / ringSegs) * Math.PI * 2;
            const th2 = ((i + 1) / ringSegs) * Math.PI * 2;
            const c1 = Math.cos(th1), s1 = Math.sin(th1);
            const c2 = Math.cos(th2), s2 = Math.sin(th2);
            const rIn = ringRad - ringThick;
            const rOut = ringRad + ringThick;
            vertices.push(
                c1*rIn, s1*rIn, 0,  c1*rOut, s1*rOut, 0,  c2*rIn, s2*rIn, 0,
                c2*rIn, s2*rIn, 0,  c1*rOut, s1*rOut, 0,  c2*rOut, s2*rOut, 0
            );
        }

        // 7. Cube
        const cubeOff = vertices.length / 3;
        const cs = 0.04;
        const cVerts = [
            -cs, -cs,  cs,   cs, -cs,  cs,  -cs,  cs,  cs,  cs, -cs,  cs,   cs,  cs,  cs,  -cs,  cs,  cs, // Front
            -cs, -cs, -cs,  -cs,  cs, -cs,   cs, -cs, -cs,  cs, -cs, -cs,  -cs,  cs, -cs,   cs,  cs, -cs, // Back
            -cs,  cs, -cs,  -cs,  cs,  cs,   cs,  cs, -cs, -cs,  cs,  cs,   cs,  cs,  cs,   cs,  cs, -cs, // Top
            -cs, -cs, -cs,   cs, -cs, -cs,  -cs, -cs,  cs,  cs, -cs, -cs,   cs, -cs,  cs,  -cs, -cs,  cs, // Bottom
             cs, -cs, -cs,   cs,  cs, -cs,   cs, -cs,  cs,  cs,  cs, -cs,   cs,  cs,  cs,   cs, -cs,  cs, // Right
            -cs, -cs, -cs,  -cs, -cs,  cs,  -cs,  cs, -cs, -cs, -cs,  cs,  -cs,  cs,  cs,  -cs,  cs, -cs, // Left
        ];
        vertices.push(...cVerts);

        this.vao = gl.createVertexArray();
        this.vbo = gl.createBuffer();
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        this.offsets = {
            cylinder: 0, cylinderCount: coneOff,
            cone: coneOff, coneCount: quadOff - coneOff,
            quad: quadOff, quadCount: 6,
            quadBorder: borderOff, quadBorderCount: 4,
            sphere: sphereOff, sphereCount: (ringOff - sphereOff),
            ring: ringOff, ringCount: cubeOff - ringOff,
            cube: cubeOff, cubeCount: 36
        };
    }

    dispose() {
        if (!this.gl) return;
        if (this.program) {
            this.gl.deleteProgram(this.program);
            this.program = null;
        }
        if (this.vbo) {
            this.gl.deleteBuffer(this.vbo);
            this.vbo = null;
        }
        if (this.vao) {
            this.gl.deleteVertexArray(this.vao);
            this.vao = null;
        }
        this.gl = null;
    }

    // Allocation-free matrix multiplication
    private multiply(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>) {
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
        let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        out[0] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
        out[1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
        out[2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
        out[3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
        b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
        out[4] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
        out[5] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
        out[6] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
        out[7] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
        b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
        out[8] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
        out[9] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
        out[10] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
        out[11] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
        b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
        out[12] = b0*a00 + b1*a10 + b2*a20 + b3*a30;
        out[13] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
        out[14] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
        out[15] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
        return out;
    }

    private ident(m: Float32Array) {
        m.fill(0); m[0]=1; m[5]=1; m[10]=1; m[15]=1;
    }

    private drawPart(
        gl: WebGL2RenderingContext,
        axis: GizmoHoverAxis,
        type: 'arrow' | 'plane' | 'sphere' | 'ring' | 'cube' | 'scale_box',
        color: number[],
        hoverAxis: GizmoHoverAxis,
        activeAxis: GizmoHoverAxis
    ) {
        const isHover = hoverAxis === axis;
        const isActive = activeAxis === axis;
        
        this.ident(this.mPart);

        // Configure Local Rotation based on Axis
        if (type === 'arrow' || type === 'scale_box') {
             // Geometry Y-up
             if (axis === 'X') {
                 // Y -> X (-90 Z)
                 this.mPart[0]=0; this.mPart[1]=-1; this.mPart[4]=1; this.mPart[5]=0;
             } else if (axis === 'Z') {
                 // Y -> Z (90 X)
                 this.mPart[5]=0; this.mPart[6]=-1; this.mPart[9]=1; this.mPart[10]=0;
             }
        } else if (type === 'ring' || type === 'plane') {
             if (axis === 'X') {
                 // Plane X normal (YZ)
                 this.mPart[0]=0; this.mPart[2]=-1; this.mPart[8]=1; this.mPart[10]=0;
             } else if (axis === 'Y') {
                 // Plane Y normal (XZ)
                 this.mPart[5]=0; this.mPart[6]=1; this.mPart[9]=-1; this.mPart[10]=0;
             }
        } else if (type === 'cube') {
             // Switch handle
             this.multiply(this.mFinal, this.mBase, this.mSwitchOffset);
             gl.uniformMatrix4fv(this.locModel, false, this.mFinal);
             gl.uniform3fv(this.locColor, (isActive || isHover) ? [1,1,0] : color);
             gl.uniform1f(this.locAlpha, 1.0);
             gl.drawArrays(gl.TRIANGLES, this.offsets!.cube, this.offsets!.cubeCount);
             return; // Special case early exit
        }

        // Apply transformations
        if (type === 'scale_box') {
             // Apply tip translation *before* axis rotation, then base
             // Order: mBase * mPart * mTipOffset
             this.multiply(this.mTip, this.mPart, this.mTipOffset);
             this.multiply(this.mFinal, this.mBase, this.mTip);
             
             gl.uniformMatrix4fv(this.locModel, false, this.mFinal);
             gl.uniform3fv(this.locColor, (isActive || isHover) ? [1,1,1] : color);
             gl.uniform1f(this.locAlpha, 1.0);
             gl.drawArrays(gl.TRIANGLES, this.offsets!.cube, this.offsets!.cubeCount);
        } else {
             // Standard Drawing
             this.multiply(this.mFinal, this.mBase, this.mPart);
             gl.uniformMatrix4fv(this.locModel, false, this.mFinal);
             
             const useHighlight = isActive || isHover;
             gl.uniform3fv(this.locColor, useHighlight ? [1,1,1] : color);
             
             if (type === 'plane') {
                 gl.uniform1f(this.locAlpha, useHighlight ? 0.5 : 0.3);
                 gl.drawArrays(gl.TRIANGLES, this.offsets!.quad, this.offsets!.quadCount);
                 if (useHighlight) {
                     gl.uniform3fv(this.locColor, [1,1,1]);
                     gl.uniform1f(this.locAlpha, 1.0);
                     gl.drawArrays(gl.LINE_LOOP, this.offsets!.quadBorder, this.offsets!.quadBorderCount);
                 }
             } else if (type === 'sphere') {
                 gl.uniform1f(this.locAlpha, 1.0);
                 gl.drawArrays(gl.TRIANGLES, this.offsets!.sphere, this.offsets!.sphereCount);
             } else if (type === 'ring') {
                 gl.uniform1f(this.locAlpha, 1.0);
                 gl.drawArrays(gl.TRIANGLES, this.offsets!.ring, this.offsets!.ringCount);
             } else if (type === 'arrow') {
                 gl.uniform1f(this.locAlpha, 1.0);
                 gl.drawArrays(gl.TRIANGLES, this.offsets!.cylinder, this.offsets!.cylinderCount);
                 gl.drawArrays(gl.TRIANGLES, this.offsets!.cone, this.offsets!.coneCount);
             }
        }
    }

    renderGizmos(
        vp: Float32Array, 
        pos: { x: number; y: number; z: number }, 
        rotation: ArrayLike<number> | null, 
        scale: number, 
        hoverAxis: GizmoHoverAxis, 
        activeAxis: GizmoHoverAxis,
        mode: GizmoMode = 'translate',
        showModeSwitch: boolean = false
    ) {
        if (!this.gl || !this.program || !this.vao || !this.offsets) return;
        const gl = this.gl;

        gl.useProgram(this.program);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.uniformMatrix4fv(this.locVP, false, vp);
        gl.bindVertexArray(this.vao);

        // 1. Update Base Matrices (No allocations)
        this.mScale[0]=scale; this.mScale[5]=scale; this.mScale[10]=scale;
        if (rotation) this.mRot.set(rotation); else this.ident(this.mRot);
        
        // mRS = Rot * Scale
        this.multiply(this.mRS, this.mRot, this.mScale);
        
        // mBase = mRS + Translation
        this.mBase.set(this.mRS);
        this.mBase[12] = pos.x; this.mBase[13] = pos.y; this.mBase[14] = pos.z;

        // 2. Draw Components
        if (mode === 'translate') {
            this.drawPart(gl, 'VIEW', 'sphere', [1,1,1], hoverAxis, activeAxis);
            this.drawPart(gl, 'X', 'plane', [0,1,1], hoverAxis, activeAxis);
            this.drawPart(gl, 'Y', 'plane', [1,0,1], hoverAxis, activeAxis);
            this.drawPart(gl, 'Z', 'plane', [1,1,0], hoverAxis, activeAxis);
            this.drawPart(gl, 'X', 'arrow', [1,0,0], hoverAxis, activeAxis);
            this.drawPart(gl, 'Y', 'arrow', [0,1,0], hoverAxis, activeAxis);
            this.drawPart(gl, 'Z', 'arrow', [0,0,1], hoverAxis, activeAxis);
        } else if (mode === 'rotate') {
             this.drawPart(gl, 'VIEW', 'sphere', [1,1,1], hoverAxis, activeAxis);
             this.drawPart(gl, 'X', 'ring', [1,0,0], hoverAxis, activeAxis);
             this.drawPart(gl, 'Y', 'ring', [0,1,0], hoverAxis, activeAxis);
             this.drawPart(gl, 'Z', 'ring', [0,0,1], hoverAxis, activeAxis);
        } else if (mode === 'scale') {
             this.drawPart(gl, 'VIEW', 'cube', [0.8,0.8,0.8], hoverAxis, activeAxis);
             this.drawPart(gl, 'X', 'plane', [0,1,1], hoverAxis, activeAxis);
             this.drawPart(gl, 'Y', 'plane', [1,0,1], hoverAxis, activeAxis);
             this.drawPart(gl, 'Z', 'plane', [1,1,0], hoverAxis, activeAxis);
             this.drawPart(gl, 'X', 'scale_box', [1,0,0], hoverAxis, activeAxis);
             this.drawPart(gl, 'Y', 'scale_box', [0,1,0], hoverAxis, activeAxis);
             this.drawPart(gl, 'Z', 'scale_box', [0,0,1], hoverAxis, activeAxis);
        }

        if (showModeSwitch) {
            this.drawPart(gl, 'SWITCH', 'cube', [0.8,0.4,0], hoverAxis, activeAxis);
        }

        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
    }
}