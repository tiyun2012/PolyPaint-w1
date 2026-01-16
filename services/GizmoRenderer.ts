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
 * Intentionally decoupled from the main WebGLRenderer so we can reuse gizmo
 * rendering across different viewport implementations (scene viewport, asset
 * preview viewports, etc.) while keeping identical visuals.
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
            // eslint-disable-next-line no-console
            console.error('GizmoRenderer link error', gl.getProgramInfoLog(prog));
            // eslint-disable-next-line no-console
            console.error('VS Log', gl.getShaderInfoLog(vs));
            // eslint-disable-next-line no-console
            console.error('FS Log', gl.getShaderInfoLog(fs));
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

        // This geometry matches the in-engine WebGLRenderer gizmo.

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

        // 3. Quad (Filled Plane)
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

    renderGizmos(vp: Float32Array, pos: { x: number; y: number; z: number }, scale: number, hoverAxis: GizmoHoverAxis, activeAxis: GizmoHoverAxis) {
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

        const drawPart = (axis: 'X' | 'Y' | 'Z' | 'VIEW', type: 'arrow' | 'plane' | 'sphere', color: number[]) => {
            const axisName = axis === 'VIEW' ? 'VIEW' : axis;
            const checkName = type === 'plane' ? (axis === 'X' ? 'YZ' : (axis === 'Y' ? 'XZ' : 'XY')) : axisName;

            const isHover = hoverAxis === checkName;
            const isActive = activeAxis === checkName;
            const baseScale = scale;

            const mIdentity = new Float32Array([
                baseScale, 0, 0, 0,
                0, baseScale, 0, 0,
                0, 0, baseScale, 0,
                pos.x, pos.y, pos.z, 1,
            ]);

            if (type === 'arrow') {
                const mArrow = new Float32Array(mIdentity);
                if (axis === 'X') {
                    mArrow[0] = 0; mArrow[1] = -baseScale;
                    mArrow[4] = baseScale; mArrow[5] = 0;
                } else if (axis === 'Z') {
                    mArrow[5] = 0; mArrow[6] = baseScale;
                    mArrow[9] = -baseScale; mArrow[10] = 0;
                }

                gl.uniformMatrix4fv(uModel, false, mArrow);
                gl.uniform3fv(uColor, (isActive || isHover) ? [1, 1, 1] : color);
                gl.uniform1f(uAlpha, 1.0);
                gl.drawArrays(gl.TRIANGLES, this.offsets!.cylinder, this.offsets!.cylinderCount);
                gl.drawArrays(gl.TRIANGLES, this.offsets!.cone, this.offsets!.coneCount);
                return;
            }

            if (type === 'sphere') {
                gl.uniformMatrix4fv(uModel, false, mIdentity);
                gl.uniform3fv(uColor, (isActive || isHover) ? [1, 1, 1] : [0.28, 0.63, 0.70]);
                gl.uniform1f(uAlpha, 1.0);
                gl.drawArrays(gl.TRIANGLES, this.offsets!.sphere, this.offsets!.sphereCount);
                return;
            }

            // plane
            if (axis === 'X') {
                const mP = new Float32Array([
                    0, 0, baseScale, 0,
                    0, baseScale, 0, 0,
                    -baseScale, 0, 0, 0,
                    pos.x, pos.y, pos.z, 1,
                ]);
                gl.uniformMatrix4fv(uModel, false, mP);
            } else if (axis === 'Y') {
                const mP = new Float32Array([
                    baseScale, 0, 0, 0,
                    0, 0, baseScale, 0,
                    0, -baseScale, 0, 0,
                    pos.x, pos.y, pos.z, 1,
                ]);
                gl.uniformMatrix4fv(uModel, false, mP);
            } else {
                gl.uniformMatrix4fv(uModel, false, mIdentity);
            }

            gl.uniform3fv(uColor, color);
            gl.uniform1f(uAlpha, (isActive || isHover) ? 0.5 : 0.3);
            gl.drawArrays(gl.TRIANGLES, this.offsets!.quad, this.offsets!.quadCount);

            if (isActive || isHover) {
                gl.uniform3fv(uColor, [1, 1, 1]);
                gl.uniform1f(uAlpha, 1.0);
                gl.drawArrays(gl.LINE_LOOP, this.offsets!.quadBorder, this.offsets!.quadBorderCount);
            }
        };

        drawPart('VIEW', 'sphere', [1, 1, 1]);
        drawPart('X', 'plane', [0, 1, 1]);
        drawPart('Y', 'plane', [1, 0, 1]);
        drawPart('Z', 'plane', [1, 1, 0]);
        drawPart('X', 'arrow', [1, 0, 0]);
        drawPart('Y', 'arrow', [0, 1, 0]);
        drawPart('Z', 'arrow', [0, 0, 1]);

        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(null);
    }
}