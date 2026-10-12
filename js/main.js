// --- Configuration & Setup ---
Physijs.scripts.worker = 'js/physijs_worker.js'; 
Physijs.scripts.ammo = 'ammo.js';

let renderer, scene, camera, clock;
let vehicle, chassis;
let trackMeshes = [];
let trackCurve, startPos, startLookAt;

// Timing State
let sessionBest = Infinity;
let currentLapStart = 0;
let previousLap = 0;
let lapCount = 1;
let halfwayCleared = false; // Used to prevent cheating/reversing over finish line

// Inputs
const keys = { w: false, a: false, s: false, d: false, r: false, n: false, c: false };
let currentCameraView = 0; // 0: Chase, 1: Hood, 2: Birdseye

// Materials
let roadMat, wallMat, startLineMat;

init();

function init() {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    scene = new Physijs.Scene();
    scene.setGravity(new THREE.Vector3(0, -50, 0)); // Stronger gravity for snappier driving
    scene.addEventListener('update', () => scene.simulate(undefined, 2));

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
    clock = new THREE.Clock();

    setupEnvironment();
    setupMaterials();
    
    // Generate first track and setup vehicle
    generateTrack();
    setupVehicle();

    setupInput();

    document.getElementById('loading').style.opacity = 0;
    setTimeout(() => document.getElementById('loading').remove(), 500);

    window.addEventListener('resize', onWindowResize, false);
    
    currentLapStart = clock.getElapsedTime();
    scene.simulate();
    render();
}

function setupEnvironment() {
    // Ground
    let groundMat = Physijs.createMaterial(new THREE.MeshLambertMaterial({ color: 0x446644 }), 0.8, 0.3);
    let ground = new Physijs.BoxMesh(new THREE.BoxGeometry(2000, 1, 2000), groundMat, 0);
    ground.position.y = -1.5;
    scene.add(ground);

    // Lighting
    let ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    let sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(100, 200, 50);
    sun.castShadow = true;
    sun.shadow.camera.left = -200;
    sun.shadow.camera.right = 200;
    sun.shadow.camera.top = 200;
    sun.shadow.camera.bottom = -200;
    scene.add(sun);
}

function setupMaterials() {
    // High friction for road to prevent sliding out instantly
    roadMat = Physijs.createMaterial(new THREE.MeshLambertMaterial({ color: 0x222222 }), 1.0, 0.1);
    startLineMat = Physijs.createMaterial(new THREE.MeshLambertMaterial({ color: 0xdddddd }), 1.0, 0.1);
    // Low friction for walls so car slides off them instead of snagging
    wallMat = Physijs.createMaterial(new THREE.MeshLambertMaterial({ color: 0xaa2222 }), 0.1, 0.4);
}

// --- Procedural Track Generation ---
function generateTrack() {
    // Remove old track
    trackMeshes.forEach(mesh => scene.remove(mesh));
    trackMeshes = [];

    const numPoints = 18;
    const points = [];
    let baseRadius = 200 + Math.random() * 100;

    // Generate random control points in a perturbed circle
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
        
        // Calculate right vector to offset walls
        let up = new THREE.Vector3(0, 1, 0);
        let right = new THREE.Vector3().crossVectors(tangent, up).normalize();

        let center = new THREE.Vector3().lerpVectors(pt, nextPt, 0.5);
        let segLength = pt.distanceTo(nextPt) * 1.1; // 10% overlap prevents snags

        // Start line material for first segment
        let currentRoadMat = (i === 0) ? startLineMat : roadMat;

        // Create Floor
        let floorGeom = new THREE.BoxGeometry(roadWidth, 1, segLength);
        let floor = new Physijs.BoxMesh(floorGeom, currentRoadMat, 0);
        floor.position.copy(center);
        floor.position.y = -0.5;
        floor.lookAt(nextPt);
        scene.add(floor);
        trackMeshes.push(floor);

        // Create Walls
        let wallGeom = new THREE.BoxGeometry(wallThick, wallHeight, segLength);
        let leftPos = center.clone().add(right.clone().multiplyScalar(roadWidth / 2));
        let rightPos = center.clone().add(right.clone().multiplyScalar(-roadWidth / 2));

        let leftWall = new Physijs.BoxMesh(wallGeom, wallMat, 0);
        leftWall.position.copy(leftPos);
        leftWall.position.y = wallHeight / 2 - 0.5;
        leftWall.lookAt(leftPos.clone().add(tangent));
        scene.add(leftWall);
        trackMeshes.push(leftWall);

        let rightWall = new Physijs.BoxMesh(wallGeom, wallMat, 0);
        rightWall.position.copy(rightPos);
        rightWall.position.y = wallHeight / 2 - 0.5;
        rightWall.lookAt(rightPos.clone().add(tangent));
        scene.add(rightWall);
        trackMeshes.push(rightWall);

        // Save spawn location
        if (i === 0) {
            startPos = pt.clone();
            startPos.y = 3;
            startLookAt = nextPt.clone();
        }
    }
}

// --- Vehicle Setup ---
function setupVehicle() {
    let chassisGeom = new THREE.BoxGeometry(2, 1.2, 4);
    let chassisMat = Physijs.createMaterial(new THREE.MeshLambertMaterial({ color: 0x1144ff }), 0.2, 0.2);
    
    chassis = new Physijs.BoxMesh(chassisGeom, chassisMat, 1000); // 1000kg
    chassis.position.copy(startPos);
    chassis.lookAt(startLookAt);
    scene.add(chassis);

    // Physijs Vehicle Tuning
    let tuning = new Physijs.VehicleTuning(
        15.0, // suspension stiffness
        1.5,  // suspension compression
        1.5,  // suspension damping
        500,  // max suspension travel
        1500, // friction slip
        2000  // max suspension force
    );

    vehicle = new Physijs.Vehicle(chassis, tuning);
    scene.addVehicle(vehicle);

    // Add Wheels
    let wheelGeom = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16);
    wheelGeom.rotateZ(Math.PI / 2);
    let wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

    const wheelPositions = [
        new THREE.Vector3(-1.1, -0.2, 1.2),  // Front Left
        new THREE.Vector3(1.1, -0.2, 1.2),   // Front Right
        new THREE.Vector3(-1.1, -0.2, -1.2), // Back Left
        new THREE.Vector3(1.1, -0.2, -1.2)   // Back Right
    ];

    wheelPositions.forEach((pos, idx) => {
        let isFront = idx < 2;
        vehicle.addWheel(
            wheelGeom, wheelMat,
            pos, // connection point
            new THREE.Vector3(0, -1, 0), // wheel direction
            new THREE.Vector3(-1, 0, 0), // wheel axle
            0.3, // suspension rest length
            0.5, // wheel radius
            isFront // is front wheel (steering)
        );
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

// --- Input & Control ---
function setupInput() {
    document.addEventListener('keydown', (e) => {
        let k = e.key.toLowerCase();
        if (k === 'w' || e.key === 'ArrowUp') keys.w = true;
        if (k === 'a' || e.key === 'ArrowLeft') keys.a = true;
        if (k === 's' || e.key === 'ArrowDown') keys.s = true;
        if (k === 'd' || e.key === 'ArrowRight') keys.d = true;
        
        // Single fire inputs
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
    if (!vehicle) return;

    // Throttle / Brake
    let engineForce = 0;
    let brakeForce = 0;
    
    // Convert current velocity to km/h
    let speed = chassis.getLinearVelocity().length() * 3.6; 
    let maxSpeed = 160;

    if (keys.w && speed < maxSpeed) engineForce = 2500;
    else if (keys.s) engineForce = -1500;

    // Apply force to rear wheels
    vehicle.applyEngineForce(engineForce, 2);
    vehicle.applyEngineForce(engineForce, 3);
    
    if (!keys.w && !keys.s) {
        vehicle.setBrake(10, 2);
        vehicle.setBrake(10, 3);
    } else {
        vehicle.setBrake(0, 2);
        vehicle.setBrake(0, 3);
    }

    // Steering
    // Dynamic steering sensitivity: lower steering at high speeds for stability
    let maxSteer = 0.5 - (Math.min(speed, 100) / 100) * 0.25; 
    
    let steering = 0;
    if (keys.a) steering = maxSteer;
    if (keys.d) steering = -maxSteer;

    vehicle.setSteering(steering, 0);
    vehicle.setSteering(steering, 1);

    document.getElementById('speedVal').innerText = Math.floor(speed);
}

// --- Lap Logic ---
function updateLapTimer() {
    let now = clock.getElapsedTime();
    let currentLapTime = now - currentLapStart;
    document.getElementById('currentLap').innerText = formatTime(currentLapTime);
    document.getElementById('lapCount').innerText = lapCount;

    if (!trackCurve) return;

    // Checkpoints based on distance to start/midway points of spline
    let distToStart = chassis.position.distanceTo(trackCurve.getPoint(0));
    let distToMid = chassis.position.distanceTo(trackCurve.getPoint(0.5));

    // Must clear halfway mark before start line counts again
    if (distToMid < 60) {
        halfwayCleared = true;
    }

    if (halfwayCleared && distToStart < 30) {
        // Lap Completed
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

// --- Rendering & Camera ---
function updateCamera() {
    if (!chassis) return;

    let targetPos, targetLookAt;

    if (currentCameraView === 0) {
        // Chase Cam
        let relativeOffset = new THREE.Vector3(0, 4, -9);
        targetPos = relativeOffset.applyMatrix4(chassis.matrixWorld);
        targetLookAt = chassis.position;
    } else if (currentCameraView === 1) {
        // Hood Cam
        let relativeOffset = new THREE.Vector3(0, 1.5, 1);
        targetPos = relativeOffset.applyMatrix4(chassis.matrixWorld);
        targetLookAt = new THREE.Vector3(0, 1.5, 20).applyMatrix4(chassis.matrixWorld);
    } else {
        // Birdseye Cam
        targetPos = chassis.position.clone().add(new THREE.Vector3(0, 40, 0));
        targetLookAt = chassis.position;
    }

    camera.position.lerp(targetPos, 0.15); // Smooth lag
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
