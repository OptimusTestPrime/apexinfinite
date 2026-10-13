// Await DOM load to prevent execution before libraries are ready
window.addEventListener('DOMContentLoaded', () => {
    
    // Explicit relative paths for GitHub Pages
    Physijs.scripts.worker = 'js/physijs_worker.js'; 
    Physijs.scripts.ammo = 'ammo.js';

    let renderer, scene, camera, clock;
    let chassis; 
    let trackMeshes = [];
    let trackCurve, startPos, startLookAt;

    let sessionBest = Infinity;
    let currentLapStart = 0;
    let previousLap = 0;
    let lapCount = 1;
    let halfwayCleared = false; 

    const keys = { w: false, a: false, s: false, d: false, r: false, n: false, c: false };
    let currentCameraView = 0; 

    let roadMat, wallMat, startLineMat;

    init();

    function init() {
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        document.body.appendChild(renderer.domElement);

        scene = new Physijs.Scene();
        scene.setGravity(new THREE.Vector3(0, -50, 0));
        scene.addEventListener('update', () => scene.simulate(undefined, 2));

        camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
        clock = new THREE.Clock();

        setupEnvironment();
        setupMaterials();
        
        generateTrack();
        setupVehicle();
        setupInput();

        // Clear loading screen on successful initialization
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
        let groundMat = Physijs.createMaterial(new THREE.MeshLambertMaterial({ color: 0x446644 }), 0.8, 0.3);
        let ground = new Physijs.BoxMesh(new THREE.BoxGeometry(2000, 1, 2000), groundMat, 0);
        ground.position.y = -1.5;
        scene.add(ground);

        let ambient = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambient);

        let sun = new THREE.DirectionalLight(0xffffff, 1.0);
        sun.position.set(100, 200, 50);
        sun.castShadow = true;
        scene.add(sun);
    }

    function setupMaterials() {
        roadMat = Physijs.createMaterial(new THREE.MeshLambertMaterial({ color: 0x222222 }), 1.0, 0.1);
        startLineMat = Physijs.createMaterial(new THREE.MeshLambertMaterial({ color: 0xdddddd }), 1.0, 0.1);
        wallMat = Physijs.createMaterial(new THREE.MeshLambertMaterial({ color: 0xaa2222 }), 0.1, 0.4);
    }

    function generateTrack() {
        trackMeshes.forEach(mesh => scene.remove(mesh));
        trackMeshes = [];

        const numPoints = 18;
        const points = [];
        let baseRadius = 200 + Math.random() * 100;

        for (let i = 0; i < numPoints; i++) {
            let angle = (i / numPoints) * Math.PI * 2;
            let r = baseRadius + (Math.random() - 0.5) * 150; 
            points.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
        }

        trackCurve = new THREE.CatmullRomCurve3(points, true);
        
        const segments = 250;
        const roadWidth = 24;
        const wallHeight = 4;
        const wallThick = 2;

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

            let currentRoadMat = (i === 0) ? startLineMat : roadMat;

            let floorGeom = new THREE.BoxGeometry(roadWidth, 1, segLength);
            let floor = new Physijs.BoxMesh(floorGeom, currentRoadMat, 0);
            floor.position.copy(center);
            floor.position.y = -0.5;
            floor.lookAt(nextPt);
            scene.add(floor);
            trackMeshes.push(floor);

            let wallGeom = new THREE.BoxGeometry(wallThick, wallHeight, segLength);
            
            let leftPos = center.clone().add(right.clone().multiplyScalar(roadWidth / 2));
            let leftWall = new Physijs.BoxMesh(wallGeom, wallMat, 0);
            leftWall.position.copy(leftPos);
            leftWall.position.y = wallHeight / 2 - 0.5;
            leftWall.lookAt(leftPos.clone().add(tangent));
            scene.add(leftWall);
            trackMeshes.push(leftWall);

            let rightPos = center.clone().add(right.clone().multiplyScalar(-roadWidth / 2));
            let rightWall = new Physijs.BoxMesh(wallGeom, wallMat, 0);
            rightWall.position.copy(rightPos);
            rightWall.position.y = wallHeight / 2 - 0.5;
            rightWall.lookAt(rightPos.clone().add(tangent));
            scene.add(rightWall);
            trackMeshes.push(rightWall);

            if (i === 0) {
                startPos = pt.clone();
                startPos.y = 3;
                startLookAt = nextPt.clone();
            }
        }
    }

    function setupVehicle() {
        // 1. Create a wide, flat, invisible physics base to prevent rolling over
        let physicsGeom = new THREE.BoxGeometry(2.5, 0.5, 4);
        let chassisMat = Physijs.createMaterial(new THREE.MeshLambertMaterial({ color: 0x1144ff }), 0.8, 0.2);
        
        chassis = new Physijs.BoxMesh(physicsGeom, chassisMat, 1000); 
        chassis.position.copy(startPos);
        chassis.lookAt(startLookAt);
        scene.add(chassis);

        // 2. Add the visible car body on top of the physics base
        let visualGeom = new THREE.BoxGeometry(2, 1.2, 4);
        let visualMat = new THREE.MeshLambertMaterial({ color: 0x1144ff });
        let visualMesh = new THREE.Mesh(visualGeom, visualMat);
        visualMesh.position.y = 0.5; // Shift the visual car up so it sits properly
        chassis.add(visualMesh);

        // 3. Add decorative wheels (visual only)
        let wheelGeom = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16);
        wheelGeom.rotateZ(Math.PI / 2);
        let wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

        const wheelPositions = [
            new THREE.Vector3(-1.2, 0, 1.2), 
            new THREE.Vector3(1.2, 0, 1.2),  
            new THREE.Vector3(-1.2, 0, -1.2),
            new THREE.Vector3(1.2, 0, -1.2)  
        ];

        wheelPositions.forEach((pos) => {
            let wheel = new THREE.Mesh(wheelGeom, wheelMat);
            wheel.position.copy(pos);
            chassis.add(wheel);
        });
    }

    function resetCar(resetLap = false) {
        chassis.__dirtyPosition = true;
        chassis.__dirtyRotation = true;
        chassis.position.copy(startPos);
        chassis.lookAt(startLookAt);
        chassis.setLinearVelocity(new THREE.Vector3(0, 0, 0));
        chassis.setAngularVelocity(new THREE.Vector3(0, 0, 0));
        
        if (resetLap) {
            currentLapStart = clock.getElapsedTime();
            halfwayCleared = false;
            lapCount = 1;
            sessionBest = Infinity;
            document.getElementById('bestLap').innerText = "--:--.---";
            document.getElementById('prevLap').innerText = "--:--.---";
        }
    }

    function setupInput() {
        document.addEventListener('keydown', (e) => {
            let k = e.key.toLowerCase();
            if (k === 'w' || e.key === 'ArrowUp') keys.w = true;
            if (k === 'a' || e.key === 'ArrowLeft') keys.a = true;
            if (k === 's' || e.key === 'ArrowDown') keys.s = true;
            if (k === 'd' || e.key === 'ArrowRight') keys.d = true;
            
            if (k === 'r') resetCar(false);
            if (k === 'n') { generateTrack(); resetCar(true); }
            if (k === 'c') currentCameraView = (currentCameraView + 1) % 3;
        });

        document.addEventListener('keyup', (e) => {
            let k = e.key.toLowerCase();
            if (k === 'w' || e.key === 'ArrowUp') keys.w = false;
            if (k === 'a' || e.key === 'ArrowLeft') keys.a = false;
            if (k === 's' || e.key === 'ArrowDown') keys.s = false;
            if (k === 'd' || e.key === 'ArrowRight') keys.d = false;
        });
    }

    function updateVehicle() {
        if (!chassis) return;

        let velocity = chassis.getLinearVelocity();
        let speed = velocity.length() * 3.6; 
        
        // Determine forward direction based on the car's current rotation matrix
        let matrix = new THREE.Matrix4().extractRotation(chassis.matrix);
        let forward = new THREE.Vector3(0, 0, 1).applyMatrix4(matrix);
        
        // Acceleration & Braking Force
        if (keys.w && speed < 160) {
            chassis.applyCentralForce(forward.multiplyScalar(20000));
        } else if (keys.s) {
            chassis.applyCentralForce(forward.multiplyScalar(-15000));
        } else {
            // Apply aggressive artificial drag when coasting
            chassis.setLinearVelocity(velocity.multiplyScalar(0.96));
        }

        // Arcade Steering (Only steer if moving)
        if (speed > 5) {
            let angularVelocity = chassis.getAngularVelocity();
            
            // Check if driving forward or reverse to invert steering intuitively
            let isReverse = velocity.dot(forward) < 0;
            let steerDir = isReverse ? -1 : 1;
            
            // Dynamic steering sensitivity: less twitchy at high speeds
            let turnSpeed = (2.0 - (Math.min(speed, 100) / 100) * 1.0) * steerDir;

            let targetY = 0;
            if (keys.a) targetY = turnSpeed;
            if (keys.d) targetY = -turnSpeed;
            
            chassis.setAngularVelocity(new THREE.Vector3(angularVelocity.x, targetY, angularVelocity.z));
        }

        document.getElementById('speedVal').innerText = Math.floor(speed);
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
            document.getElementById('prevLap').innerText = formatTime(previousLap);
            
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
        let millis = Math.floor((secs % 1) * 1000);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
    }

    function showNewRecord() {
        let msg = document.getElementById('new-record');
        msg.style.opacity = 1;
        setTimeout(() => msg.style.opacity = 0, 3000);
    }

    function updateCamera() {
        if (!chassis) return;

        let targetPos, targetLookAt;

        if (currentCameraView === 0) {
            let relativeOffset = new THREE.Vector3(0, 4, -9);
            targetPos = relativeOffset.applyMatrix4(chassis.matrixWorld);
            targetLookAt = chassis.position;
        } else if (currentCameraView === 1) {
            let relativeOffset = new THREE.Vector3(0, 1.5, 1);
            targetPos = relativeOffset.applyMatrix4(chassis.matrixWorld);
            targetLookAt = new THREE.Vector3(0, 1.5, 20).applyMatrix4(chassis.matrixWorld);
        } else {
            targetPos = chassis.position.clone().add(new THREE.Vector3(0, 40, 0));
            targetLookAt = chassis.position;
        }

        camera.position.lerp(targetPos, 0.15); 
        camera.lookAt(targetLookAt);
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
