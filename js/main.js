window.addEventListener('DOMContentLoaded', () => {
    
    // Explicit relative paths for GitHub Pages
    Physijs.scripts.worker = 'js/physijs_worker.js'; 
    Physijs.scripts.ammo = 'ammo.js';

    let renderer, scene, camera, clock;
    let chassis; 
    let trackPhysicsMeshes = [];
    let visualTrackGroup;
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
        renderer.setClearColor(0x87CEEB); 
        document.body.appendChild(renderer.domElement);

        scene = new Physijs.Scene();
        scene.setGravity(new THREE.Vector3(0, -50, 0));
        scene.fog = new THREE.Fog(0x87CEEB, 100, 800); 
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
        if (visualTrackGroup) scene.remove(visualTrackGroup);
        visualTrackGroup = new THREE.Group();
        scene.add(visualTrackGroup);

        trackPhysicsMeshes.forEach(mesh => scene.remove(mesh));
        trackPhysicsMeshes = [];

        const numPoints = 16;
        const points = [];
        let baseRadius = 250;
        for (let i = 0; i < numPoints; i++) {
            let angle = (i / numPoints) * Math.PI * 2;
            let r = baseRadius + (Math.random() - 0.5) * 150; 
            points.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
        }
        trackCurve = new THREE.CatmullRomCurve3(points, true);

        const segments = 250;
        const roadWidth = 24;
        const wallHeight = 4;

        // 1. Construct continuous geometric ribbons for perfect visuals (No twisting)
        let roadGeom = new THREE.Geometry();
        let leftWallGeom = new THREE.Geometry();
        let rightWallGeom = new THREE.Geometry();

        for (let i = 0; i <= segments; i++) {
            let t = (i % segments) / segments; 
            let pt = trackCurve.getPoint(t);
            let tangent = trackCurve.getTangent(t).normalize();
            let right = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize(); 

            let pLeft = pt.clone().add(right.clone().multiplyScalar(roadWidth / 2));
            let pRight = pt.clone().add(right.clone().multiplyScalar(-roadWidth / 2));
            roadGeom.vertices.push(pLeft, pRight);

            leftWallGeom.vertices.push(pLeft, pLeft.clone().add(new THREE.Vector3(0, wallHeight, 0)));
            rightWallGeom.vertices.push(pRight, pRight.clone().add(new THREE.Vector3(0, wallHeight, 0)));
        }

        for (let i = 0; i < segments; i++) {
            let v = i * 2;
            roadGeom.faces.push(new THREE.Face3(v, v+1, v+2));
            roadGeom.faces.push(new THREE.Face3(v+1, v+3, v+2));
            
            leftWallGeom.faces.push(new THREE.Face3(v, v+2, v+1));
            leftWallGeom.faces.push(new THREE.Face3(v+1, v+2, v+3));
            
            rightWallGeom.faces.push(new THREE.Face3(v, v+1, v+2));
            rightWallGeom.faces.push(new THREE.Face3(v+1, v+3, v+2));
        }
        
        roadGeom.computeFaceNormals();
        leftWallGeom.computeFaceNormals();
        rightWallGeom.computeFaceNormals();

        let visualRoad = new THREE.Mesh(roadGeom, new THREE.MeshLambertMaterial({ color: 0x333333 }));
        let visualLeftWall = new THREE.Mesh(leftWallGeom, new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
        let visualRightWall = new THREE.Mesh(rightWallGeom, new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
        
        visualTrackGroup.add(visualRoad);
        visualTrackGroup.add(visualLeftWall);
        visualTrackGroup.add(visualRightWall);

        // 2. Invisible Physics Blocks (Thick overlapping geometry completely prevents falling through)
        let invisibleRoadMat = Physijs.createMaterial(new THREE.MeshBasicMaterial({ visible: false }), 0.8, 0.2);
        let invisibleWallMat = Physijs.createMaterial(new THREE.MeshBasicMaterial({ visible: false }), 0.1, 0.2);

        for (let i = 0; i < segments; i++) {
            let t = i / segments;
            let nextT = ((i + 1) % segments) / segments;
            
            let pt = trackCurve.getPoint(t);
            let nextPt = trackCurve.getPoint(nextT);
            let tangent = trackCurve.getTangent(t).normalize();
            let right = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
            let center = new THREE.Vector3().lerpVectors(pt, nextPt, 0.5);
            let segLength = pt.distanceTo(nextPt) * 1.1; 

            // Floor Block (Thickness of 1, top face rests exactly at Y=0)
            let floorGeom = new THREE.BoxGeometry(roadWidth, 1, segLength);
            let floor = new Physijs.BoxMesh(floorGeom, invisibleRoadMat, 0);
            floor.position.copy(center);
            floor.position.y = -0.5; 
            floor.lookAt(nextPt);
            floor.visible = false;
            scene.add(floor);
            trackPhysicsMeshes.push(floor);

            // Wall Blocks
            let leftPos = center.clone().add(right.clone().multiplyScalar(roadWidth / 2));
            let leftWall = new Physijs.BoxMesh(new THREE.BoxGeometry(2, wallHeight, segLength), invisibleWallMat, 0);
            leftWall.position.copy(leftPos);
            leftWall.position.y = wallHeight / 2;
            leftWall.lookAt(leftPos.clone().add(tangent));
            leftWall.visible = false;
            scene.add(leftWall);
            trackPhysicsMeshes.push(leftWall);

            let rightPos = center.clone().add(right.clone().multiplyScalar(-roadWidth / 2));
            let rightWall = new Physijs.BoxMesh(new THREE.BoxGeometry(2, wallHeight, segLength), invisibleWallMat, 0);
            rightWall.position.copy(rightPos);
            rightWall.position.y = wallHeight / 2;
            rightWall.lookAt(rightPos.clone().add(tangent));
            rightWall.visible = false;
            scene.add(rightWall);
            trackPhysicsMeshes.push(rightWall);

            if (i === 0) {
                startPos = pt.clone();
                startPos.y = 1.5; 
                startLookAt = nextPt.clone();
            }
        }

        createStartLine(trackCurve.getPoint(0), trackCurve.getPoint(0.01));
    }

    function createStartLine(pos, lookAtTarget) {
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
        linePlane.position.y = 0.05; 
        linePlane.lookAt(lookAtTarget);
        linePlane.rotateX(-Math.PI / 2);
        visualTrackGroup.add(linePlane);
    }

    function setupVehicle() {
        // Anti-Snag Sphere Physics Base (Rides over BoxMesh seams smoothly)
        let physicsGeom = new THREE.SphereGeometry(1.2, 16, 16);
        let chassisMat = Physijs.createMaterial(new THREE.MeshBasicMaterial({ visible: false }), 0.6, 0.2);
        
        chassis = new Physijs.SphereMesh(physicsGeom, chassisMat, 1000); 
        chassis.position.copy(startPos);
        chassis.lookAt(startLookAt);
        // Lock rotation on X and Z so it acts like a car, not a rolling ball
        chassis.setAngularFactor(new THREE.Vector3(0, 1, 0)); 
        scene.add(chassis);

        // Visual Assembly
        let carGroup = new THREE.Group();
        // Shift visual model down by 1.1 units so the tires perfectly touch Y=0 when the sphere rests at Y=1.2
        carGroup.position.y = -1.1; 

        let whiteMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
        let glassMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

        let bodyGeo = new THREE.BoxGeometry(2.0, 0.5, 4.2);
        let body = new THREE.Mesh(bodyGeo, whiteMat);
        body.position.y = 0.25; 
        carGroup.add(body);

        let cabinGeo = new THREE.BoxGeometry(1.4, 0.4, 2.0);
        let cabin = new THREE.Mesh(cabinGeo, glassMat);
        cabin.position.set(0, 0.7, 0.2);
        carGroup.add(cabin);

        let spoilerGeo = new THREE.BoxGeometry(1.8, 0.05, 0.4);
        let spoiler = new THREE.Mesh(spoilerGeo, whiteMat);
        spoiler.position.set(0, 0.8, -1.8);
        carGroup.add(spoiler);

        let strutGeo = new THREE.BoxGeometry(0.05, 0.3, 0.2);
        let strutL = new THREE.Mesh(strutGeo, glassMat);
        strutL.position.set(-0.6, 0.65, -1.8);
        carGroup.add(strutL);
        let strutR = new THREE.Mesh(strutGeo, glassMat);
        strutR.position.set(0.6, 0.65, -1.8);
        carGroup.add(strutR);

        // Tires
        let wheelGeom = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
        wheelGeom.rotateZ(Math.PI / 2);
        const wheelPositions = [
            new THREE.Vector3(-1.1, 0.1, 1.2), new THREE.Vector3(1.1, 0.1, 1.2),  
            new THREE.Vector3(-1.1, 0.1, -1.2), new THREE.Vector3(1.1, 0.1, -1.2)  
        ];
        wheelPositions.forEach(pos => {
            let w = new THREE.Mesh(wheelGeom, glassMat);
            w.position.copy(pos);
            carGroup.add(w);
        });

        chassis.add(carGroup);
    }

    function setupInput() {
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
            chassis.applyCentralForce(forward.multiplyScalar(35000)); 
        } else if (keys.s) {
            chassis.applyCentralForce(forward.multiplyScalar(-25000));
        } else {
            chassis.setLinearVelocity(velocity.multiplyScalar(0.96)); 
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

        const speedDisplay = document.getElementById('speedVal');
        if (speedDisplay) speedDisplay.innerText = Math.floor(speed);
        
        const speedBar = document.getElementById('speedBarFill');
        if (speedBar) speedBar.style.width = Math.min(speed / 1.8, 100) + '%';
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
        if (!msg) return;
        msg.style.opacity = 1;
        setTimeout(() => msg.style.opacity = 0, 3000);
    }

    function updateCamera() {
        if (!chassis) return;

        let relativeOffset = new THREE.Vector3(0, 3, 10);
        let targetPos = relativeOffset.applyMatrix4(chassis.matrixWorld);
        
        camera.position.lerp(targetPos, 0.15); 
        camera.lookAt(chassis.position.clone().add(new THREE.Vector3(0, 1, -5)));
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
