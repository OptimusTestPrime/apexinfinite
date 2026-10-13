window.addEventListener('DOMContentLoaded', () => {
    
    Physijs.scripts.worker = 'js/physijs_worker.js'; 
    Physijs.scripts.ammo = 'ammo.js';

    let renderer, scene, camera, clock;
    let chassis; 
    let trackPhysicsMeshes = [];
    let trackVisualMesh;
    let trackCurve, startPos, startLookAt;

    let sessionBest = Infinity;
    let currentLapStart = 0;
    let previousLap = 0;
    let lapCount = 1;
    let halfwayCleared = false; 

    const keys = { w: false, a: false, s: false, d: false, r: false, n: false, c: false };

    init();

    function init() {
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.setClearColor(0x87CEEB); // Sky blue background
        document.body.appendChild(renderer.domElement);

        scene = new Physijs.Scene();
        scene.setGravity(new THREE.Vector3(0, -50, 0));
        scene.fog = new THREE.Fog(0x87CEEB, 100, 800); // Blend track into horizon
        scene.addEventListener('update', () => scene.simulate(undefined, 2));

        camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        clock = new THREE.Clock();

        setupEnvironment();
        generateTrack();
        setupVehicle();
        setupInput();

        const loader = document.getElementById('loading');
        if (loader) {
            loader.style.opacity = 0;
            setTimeout(() => loader.remove(), 500);
        }

        window.addEventListener('resize', onWindowResize, false);
        
        currentLapStart = clock.getElapsedTime();
        scene.simulate();
        render();
    }

    function setupEnvironment() {
        // Massive grass plane
        let groundGeom = new THREE.PlaneGeometry(4000, 4000);
        let groundMat = new THREE.MeshLambertMaterial({ color: 0x5a8a5a });
        let ground = new THREE.Mesh(groundGeom, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -2;
        scene.add(ground);

        let ambient = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambient);

        let sun = new THREE.DirectionalLight(0xffffff, 0.8);
        sun.position.set(100, 300, 100);
        sun.castShadow = true;
        scene.add(sun);
    }

    function generateTrack() {
        // Remove old track elements
        trackPhysicsMeshes.forEach(mesh => scene.remove(mesh));
        trackPhysicsMeshes = [];
        if (trackVisualMesh) scene.remove(trackVisualMesh);

        // 1. Generate Spline
        const numPoints = 16;
        const points = [];
        let baseRadius = 250;

        for (let i = 0; i < numPoints; i++) {
            let angle = (i / numPoints) * Math.PI * 2;
            let r = baseRadius + (Math.random() - 0.5) * 150; 
            points.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
        }
        trackCurve = new THREE.CatmullRomCurve3(points, true);

        // 2. Generate Smooth Visual Track (ExtrudeGeometry)
        let shape = new THREE.Shape();
        shape.moveTo(-13, 2); // Left Wall Top
        shape.lineTo(-12, 2); 
        shape.lineTo(-12, 0); // Road Left
        shape.lineTo(12, 0);  // Road Right
        shape.lineTo(12, 2);  // Right Wall Inner
        shape.lineTo(13, 2);  // Right Wall Top

        let extrudeSettings = { steps: 300, extrudePath: trackCurve, bevelEnabled: false };
        let trackVisualGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        let trackVisualMat = new THREE.MeshLambertMaterial({ color: 0x333333, wireframe: false });
        trackVisualMesh = new THREE.Mesh(trackVisualGeom, trackVisualMat);
        trackVisualMesh.position.y = -0.5; // Sink slightly to align with physics
        scene.add(trackVisualMesh);

        // 3. Generate Invisible Physics Track (0 Friction to prevent snagging)
        let invisibleRoadMat = Physijs.createMaterial(new THREE.MeshBasicMaterial(), 0.0, 0.0); // ZERO FRICTION
        let invisibleWallMat = Physijs.createMaterial(new THREE.MeshBasicMaterial(), 0.0, 0.0);
        
        const segments = 250;
        const roadWidth = 24;

        for (let i = 0; i < segments; i++) {
            let t = i / segments;
            let nextT = ((i + 1) % segments) / segments;
            
            let pt = trackCurve.getPoint(t);
            let nextPt = trackCurve.getPoint(nextT);
            let tangent = trackCurve.getTangent(t).normalize();
            
            let up = new THREE.Vector3(0, 1, 0);
            let right = new THREE.Vector3().crossVectors(tangent, up).normalize();

            let center = new THREE.Vector3().lerpVectors(pt, nextPt, 0.5);
            let segLength = pt.distanceTo(nextPt) * 1.1; 

            // Floor collision box (Invisible)
            let floorGeom = new THREE.BoxGeometry(roadWidth, 1, segLength);
            let floor = new Physijs.BoxMesh(floorGeom, invisibleRoadMat, 0);
            floor.position.copy(center);
            floor.position.y = -1.0;
            floor.lookAt(nextPt);
            floor.visible = false; 
            scene.add(floor);
            trackPhysicsMeshes.push(floor);

            // Left wall collision box (Invisible)
            let leftPos = center.clone().add(right.clone().multiplyScalar(roadWidth / 2));
            let leftWall = new Physijs.BoxMesh(new THREE.BoxGeometry(2, 4, segLength), invisibleWallMat, 0);
            leftWall.position.copy(leftPos);
            leftWall.position.y = 1;
            leftWall.lookAt(leftPos.clone().add(tangent));
            leftWall.visible = false;
            scene.add(leftWall);
            trackPhysicsMeshes.push(leftWall);

            // Right wall collision box (Invisible)
            let rightPos = center.clone().add(right.clone().multiplyScalar(-roadWidth / 2));
            let rightWall = new Physijs.BoxMesh(new THREE.BoxGeometry(2, 4, segLength), invisibleWallMat, 0);
            rightWall.position.copy(rightPos);
            rightWall.position.y = 1;
            rightWall.lookAt(rightPos.clone().add(tangent));
            rightWall.visible = false;
            scene.add(rightWall);
            trackPhysicsMeshes.push(rightWall);

            if (i === 0) {
                startPos = pt.clone();
                startPos.y = 2;
                startLookAt = nextPt.clone();
            }
        }

        // 4. Start Line Graphic
        createStartLine(startPos, startLookAt);
    }

    function createStartLine(pos, lookAtTarget) {
        // Generate a checkered pattern purely in code
        let canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 128;
        let ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white'; ctx.fillRect(0,0,512,128);
        ctx.fillStyle = 'black';
        for(let x=0; x<512; x+=64) {
            for(let y=0; y<128; y+=64) {
                if((x+y)%128 === 0) ctx.fillRect(x,y,64,64);
            }
        }
        let tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 1);

        let lineMat = new THREE.MeshBasicMaterial({ map: tex });
        let linePlane = new THREE.Mesh(new THREE.PlaneGeometry(24, 4), lineMat);
        linePlane.position.copy(pos);
        linePlane.position.y = -0.4; // Slightly above visual road
        linePlane.lookAt(lookAtTarget);
        linePlane.rotateX(-Math.PI / 2);
        scene.add(linePlane);
        trackPhysicsMeshes.push(linePlane);
    }

    function setupVehicle() {
        // Invisible physics base
        let physicsGeom = new THREE.BoxGeometry(2.2, 0.5, 4);
        let chassisMat = Physijs.createMaterial(new THREE.MeshBasicMaterial(), 0.1, 0.2);
        
        chassis = new Physijs.BoxMesh(physicsGeom, chassisMat, 1000); 
        chassis.position.copy(startPos);
        chassis.lookAt(startLookAt);
        scene.add(chassis);

        // Modern Supercar Assembly
        let carGroup = new THREE.Group();
        carGroup.position.y = 0.5;

        let whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        let glassMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

        // Main Body
        let bodyGeo = new THREE.BoxGeometry(2.0, 0.5, 4.2);
        let body = new THREE.Mesh(bodyGeo, whiteMat);
        body.position.y = 0.25;
        carGroup.add(body);

        // Cabin
        let cabinGeo = new THREE.BoxGeometry(1.4, 0.4, 2.0);
        let cabin = new THREE.Mesh(cabinGeo, glassMat);
        cabin.position.set(0, 0.7, 0.2);
        carGroup.add(cabin);

        // Spoiler
        let spoilerGeo = new THREE.BoxGeometry(1.8, 0.05, 0.4);
        let spoiler = new THREE.Mesh(spoilerGeo, whiteMat);
        spoiler.position.set(0, 0.8, -1.8);
        carGroup.add(spoiler);

        // Spoiler Struts
        let strutGeo = new THREE.BoxGeometry(0.05, 0.3, 0.2);
        let strutL = new THREE.Mesh(strutGeo, glassMat);
        strutL.position.set(-0.6, 0.65, -1.8);
        carGroup.add(strutL);
        let strutR = new THREE.Mesh(strutGeo, glassMat);
        strutR.position.set(0.6, 0.65, -1.8);
        carGroup.add(strutR);

        // Decorative Wheels
        let wheelGeom = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
        wheelGeom.rotateZ(Math.PI / 2);
        const wheelPositions = [
            new THREE.Vector3(-1.1, 0.2, 1.2), new THREE.Vector3(1.1, 0.2, 1.2),  
            new THREE.Vector3(-1.1, 0.2, -1.2), new THREE.Vector3(1.1, 0.2, -1.2)  
        ];
        wheelPositions.forEach(pos => {
            let w = new THREE.Mesh(wheelGeom, glassMat);
            w.position.copy(pos);
            carGroup.add(w);
        });

        chassis.add(carGroup);
    }

    function setupInput() {
        // Keyboard Controls
        document.addEventListener('keydown', (e) => {
            let k = e.key.toLowerCase();
            if (k === 'w' || e.key === 'ArrowUp') keys.w = true;
            if (k === 'a' || e.key === 'ArrowLeft') keys.a = true;
            if (k === 's' || e.key === 'ArrowDown') keys.s = true;
            if (k === 'd' || e.key === 'ArrowRight') keys.d = true;
        });

        document.addEventListener('keyup', (e) => {
            let k = e.key.toLowerCase();
            if (k === 'w' || e.key === 'ArrowUp') keys.w = false;
            if (k === 'a' || e.key === 'ArrowLeft') keys.a = false;
            if (k === 's' || e.key === 'ArrowDown') keys.s = false;
            if (k === 'd' || e.key === 'ArrowRight') keys.d = false;
        });

        // Pointer Events
        const bindButton = (id, key) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            const press = (e) => { e.preventDefault(); keys[key] = true; btn.style.background = 'rgba(255,255,255,0.4)'; };
            const release = (e) => { e.preventDefault(); keys[key] = false; btn.style.background = 'rgba(255,255,255,0.15)'; };
            btn.addEventListener('pointerdown', press);
            btn.addEventListener('pointerup', release);
            btn.addEventListener('pointerout', release);
            btn.addEventListener('pointercancel', release);
        };

        bindButton('btn-up', 'w');
        bindButton('btn-down', 's');
        bindButton('btn-left', 'a');
        bindButton('btn-right', 'd');
    }

    function updateVehicle() {
        if (!chassis) return;

        let velocity = chassis.getLinearVelocity();
        let angularVelocity = chassis.getAngularVelocity();
        let speed = velocity.length() * 3.6; 
        
        // Anti-sleep hack
        if (keys.w || keys.s || keys.a || keys.d) {
            chassis.setLinearVelocity(new THREE.Vector3(velocity.x, velocity.y, velocity.z));
            chassis.setAngularVelocity(new THREE.Vector3(angularVelocity.x, angularVelocity.y, angularVelocity.z));
        }

        let matrix = new THREE.Matrix4().extractRotation(chassis.matrix);
        let forward = new THREE.Vector3(0, 0, -1).applyMatrix4(matrix);
        
        if (keys.w && speed < 180) {
            chassis.applyCentralForce(forward.multiplyScalar(22000)); // Slightly faster
        } else if (keys.s) {
            chassis.applyCentralForce(forward.multiplyScalar(-18000));
        } else {
            chassis.setLinearVelocity(velocity.multiplyScalar(0.97)); // Coasting friction
        }

        if (speed > 5) {
            let isReverse = velocity.dot(forward) < 0;
            let steerDir = isReverse ? -1 : 1;
            let turnSpeed = (2.0 - (Math.min(speed, 120) / 120) * 1.0) * steerDir;

            let targetY = 0;
            if (keys.a) targetY = turnSpeed;
            if (keys.d) targetY = -turnSpeed;
            
            chassis.setAngularVelocity(new THREE.Vector3(angularVelocity.x, targetY, angularVelocity.z));
        }

        // Update UI
        document.getElementById('speedVal').innerText = Math.floor(speed);
        document.getElementById('speedBarFill').style.width = Math.min(speed / 1.8, 100) + '%';
    }

    function updateLapTimer() {
        let now = clock.getElapsedTime();
        let currentLapTime = now - currentLapStart;
        
        document.getElementById('currentLap').innerText = formatTime(currentLapTime);
        document.getElementById('lapCount').innerText = lapCount;

        if (!trackCurve) return;

        let distToStart = chassis.position.distanceTo(trackCurve.getPoint(0));
        let distToMid = chassis.position.distanceTo(trackCurve.getPoint(0.5));

        if (distToMid < 60) halfwayCleared = true;

        if (halfwayCleared && distToStart < 30) {
            previousLap = currentLapTime;
            
            if (previousLap < sessionBest) {
                sessionBest = previousLap;
                document.getElementById('bestLap').innerText = formatTime(sessionBest);
                showNewRecord();
            }

            currentLapStart = now;
            lapCount++;
            halfwayCleared = false;
        }
    }

    function formatTime(secs) {
        let minutes = Math.floor(secs / 60);
        let seconds = Math.floor(secs % 60);
        let millis = Math.floor((secs % 1) * 100);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(2, '0')}`;
    }

    function showNewRecord() {
        let msg = document.getElementById('new-record');
        msg.style.opacity = 1;
        setTimeout(() => msg.style.opacity = 0, 3000);
    }

    function updateCamera() {
        if (!chassis) return;

        // Modern slightly lower chase camera
        let relativeOffset = new THREE.Vector3(0, 3, 10);
        let targetPos = relativeOffset.applyMatrix4(chassis.matrixWorld);
        
        camera.position.lerp(targetPos, 0.15); 
        camera.lookAt(chassis.position);
    }

    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    function render() {
        requestAnimationFrame(render);
        updateVehicle();
        updateCamera();
        updateLapTimer();
        renderer.render(scene, camera);
    }
});
