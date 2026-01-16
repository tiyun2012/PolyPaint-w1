export type GizmoHoverAxis = 'X' | 'Y' | 'Z' | 'XY' | 'XZ' | 'YZ' | 'VIEW' | null;

type GizmoOffsets = {
    cylinder: number; cylinderCount: number;
    cone: number; coneCount: number;
    quad: number; quadCount: number;
    quadBorder: number; quadBorderCount: number;
    sphere: number; sphereCount: number;
};

/**
 * Lightweight standalone gizmo renderer.
 * 
 * Supports rendering a 3D transformation gizmo with:
 * - Arbitrary Position
 * - Arbitrary Rotation (Matrix4)
 * - Scale
 * - Hover/Active states
 */
export class GizmoRenderer {
    private gl: WebGL2RenderingContext | null = null;
    private program: WebGLProgram | null = null;
    private vao: WebGLVertexArrayObject | null = null;
    private offsets: GizmoOffsets | null = null;

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

        const vertices: number[] = [];

        // Geometry (Y-Up default for cylinder/cone in this construction)
        // 1. Cylinder (Arrow Stem)
        const stemLen = 0.6;
        const stemRad = 0.005;
        const segs = 16;
        for (let i = 0; i < segs; i++) {
            const th = (i / segs) * Math.PI * 2;
            const th2 = ((i + 1) / segs) * Math.PI * 2;
            const x1 = Math.cos(th) * stemRad;
            const z1 = Math.sin(th) * stemRad;
            const x2 = Math.cos(th2) * stemRad;
            const z2 = Math.sin(th2) * stemRad;
            // Vertical Cylinder (along Y)
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
            const x1 = Math.cos(th) * tipRad;
            const z1 = Math.sin(th) * tipRad;
            const x2 = Math.cos(th2) * tipRad;
            const z2 = Math.sin(th2) * tipRad;
            vertices.push(x1, tipStart, z1, x2, tipStart, z2, 0, tipEnd, 0);
            vertices.push(x1, tipStart, z1, 0, tipStart, 0, x2, tipStart, z2);
        }

        // 3. Quad (Filled Plane - Default on XY plane in geometry, but small offset)
        // We actually define it on XY plane.
        const quadOff = vertices.length / 3;
        const qS = 0.1, qO = 0.1;
        vertices.push(qO, qO, 0, qO + qS, qO, 0, qO, qO + qS, 0);
        vertices.push(qO + qS, qO, 0, qO + qS, qO + qS, 0, qO, qO + qS, 0);

        // 4. Quad Border (Wireframe)
        const borderOff = vertices.length / 3;
        vertices.push(qO, qO, 0, qO + qS, qO, 0, qO + qS, qO + qS, 0, qO, qO + qS, 0);

        // 5. Sphere (Center Ball)
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

        this.vao = gl.createVertexArray();
        const vbo = gl.createBuffer();
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        this.offsets = {
            cylinder: 0, cylinderCount: coneOff,
            cone: coneOff, coneCount: quadOff - coneOff,
            quad: quadOff, quadCount: 6,
            quadBorder: borderOff, quadBorderCount: 4,
            sphere: sphereOff, sphereCount: (vertices.length / 3) - sphereOff,
        };
    }

    // Helper: 4x4 Matrix Multiply (A * B)
    private multiply(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>) {
        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
        let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
        out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
        out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
        out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
        out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        return out;
    }

    /**
     * Renders the Gizmo.
     * @param vp ViewProjection Matrix (4x4)
     * @param pos World Position {x,y,z}
     * @param rotation Rotation Matrix (4x4). If null, Identity is used.
     * @param scale Overall Scale
     * @param hoverAxis Current Hover Axis ID
     * @param activeAxis Current Active Axis ID
     */
    renderGizmos(
        vp: Float32Array, 
        pos: { x: number; y: number; z: number }, 
        rotation: ArrayLike<number> | null, 
        scale: number, 
        hoverAxis: GizmoHoverAxis, 
        activeAxis: GizmoHoverAxis
    ) {
        if (!this.gl || !this.program || !this.vao || !this.offsets) return;
        const gl = this.gl;

        gl.useProgram(this.program);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'u_vp'), false, vp);
        const uModel = gl.getUniformLocation(this.program, 'u_model');
        const uColor = gl.getUniformLocation(this.program, 'u_color');
        const uAlpha = gl.getUniformLocation(this.program, 'u_alpha');

        gl.bindVertexArray(this.vao);

        // 1. Construct Base Transform = Translate(pos) * Rotation * Scale
        const mBase = new Float32Array(16);
        // Scale Matrix
        const mScale = [scale,0,0,0, 0,scale,0,0, 0,0,scale,0, 0,0,0,1];
        
        // Rotation Matrix
        // If rotation provided, use it. Else Identity.
        const mRot = rotation ? rotation : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

        // Combine Scale & Rotation: Temp = Rot * Scale
        const mRS = new Float32Array(16);
        this.multiply(mRS, mRot, mScale);

        // Apply Translation
        // Base = mRS, but put Pos in last column
        mBase.set(mRS);
        mBase[12] = pos.x; mBase[13] = pos.y; mBase[14] = pos.z; mBase[15] = 1;

        // Buffers for calculation
        const mFinal = new Float32Array(16);
        const mPart = new Float32Array(16); // Local part rotation/offset

        const drawPart = (axis: 'X' | 'Y' | 'Z' | 'VIEW', type: 'arrow' | 'plane' | 'sphere', color: number[]) => {
            const axisName = axis === 'VIEW' ? 'VIEW' : axis;
            const checkName = type === 'plane' ? (axis === 'X' ? 'YZ' : (axis === 'Y' ? 'XZ' : 'XY')) : axisName;

            const isHover = hoverAxis === checkName;
            const isActive = activeAxis === checkName;

            // Reset part matrix to identity
            mPart.fill(0); mPart[0]=1; mPart[5]=1; mPart[10]=1; mPart[15]=1;

            if (type === 'arrow') {
                // Geometry is Y-up.
                if (axis === 'X') {
                    // Rotate Y to X: -90 deg around Z
                    // [ 0  1  0]
                    // [-1  0  0]
                    // [ 0  0  1]
                    mPart[0] = 0; mPart[1] = -1; 
                    mPart[4] = 1; mPart[5] = 0; 
                } else if (axis === 'Z') {
                    // Rotate Y to Z: 90 deg around X
                    // [ 1  0  0]
                    // [ 0  0 -1]
                    // [ 0  1  0]
                    mPart[5] = 0; mPart[6] = -1;
                    mPart[9] = 1; mPart[10] = 0;
                }
                // Y is Identity (matches geom)

                this.multiply(mFinal, mBase, mPart);
                gl.uniformMatrix4fv(uModel, false, mFinal);
                gl.uniform3fv(uColor, (isActive || isHover) ? [1, 1, 1] : color);
                gl.uniform1f(uAlpha, 1.0);
                gl.drawArrays(gl.TRIANGLES, this.offsets!.cylinder, this.offsets!.cylinderCount);
                gl.drawArrays(gl.TRIANGLES, this.offsets!.cone, this.offsets!.coneCount);
            }
            else if (type === 'sphere') {
                // Center Sphere - Just Base Transform
                gl.uniformMatrix4fv(uModel, false, mBase);
                gl.uniform3fv(uColor, (isActive || isHover) ? [1, 1, 1] : [0.8, 0.8, 0.8]);
                gl.uniform1f(uAlpha, 1.0);
                gl.drawArrays(gl.TRIANGLES, this.offsets!.sphere, this.offsets!.sphereCount);
            }
            else if (type === 'plane') {
                // Geometry is Plane on XY (+ offset).
                if (axis === 'X') {
                    // YZ Plane -> Rotate geom XY to YZ. 
                    // Rotate X to Y, Y to Z? 
                    // Geom is XY. We want YZ. 
                    // Rotate Y-axis 90 deg around Y? No.
                    // Rotate -90 around Y -> X becomes Z. Y stays Y. -> ZY Plane.
                    mPart[0] = 0; mPart[2] = -1;
                    mPart[8] = 1; mPart[10] = 0;
                } else if (axis === 'Y') {
                    // XZ Plane -> Rotate geom XY to XZ.
                    // Rotate 90 around X -> Y becomes Z.
                    mPart[5] = 0; mPart[6] = 1;
                    mPart[9] = -1; mPart[10] = 0;
                }
                // Z is XY Plane (matches geom)

                this.multiply(mFinal, mBase, mPart);
                gl.uniformMatrix4fv(uModel, false, mFinal);
                gl.uniform3fv(uColor, color);
                gl.uniform1f(uAlpha, (isActive || isHover) ? 0.5 : 0.3);
                gl.drawArrays(gl.TRIANGLES, this.offsets!.quad, this.offsets!.quadCount);

                if (isActive || isHover) {
                    gl.uniform3fv(uColor, [1, 1, 1]);
                    gl.uniform1f(uAlpha, 1.0);
                    gl.drawArrays(gl.LINE_LOOP, this.offsets!.quadBorder, this.offsets!.quadBorderCount);
                }
            }
        };

        drawPart('VIEW', 'sphere', [1, 1, 1]);
        drawPart('X', 'plane', [0, 1, 1]); // YZ
        drawPart('Y', 'plane', [1, 0, 1]); // XZ
        drawPart('Z', 'plane', [1, 1, 0]); // XY
        drawPart('X', 'arrow', [1, 0, 0]);
        drawPart('Y', 'arrow', [0, 1, 0]);
        drawPart('Z', 'arrow', [0, 0, 1]);

        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
    }
}