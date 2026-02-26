import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GraphData } from '../types';

/**
 * 3D Graph Renderer using Three.js
 */
export class Graph3DRenderer {
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private renderer: THREE.WebGLRenderer;
	private controls: OrbitControls;
	private simulation: any;
	private nodeMeshes: Map<string, THREE.Mesh> = new Map();
	private linkLines: THREE.Line[] = [];
	private container: HTMLElement;
	private animationId: number | null = null;
	private onNodeClick: ((node: any) => void) | null = null;
	private raycaster: THREE.Raycaster;
	private mouse: THREE.Vector2;

	constructor (container: HTMLElement) {
		this.container = container;

		// Setup scene
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x1e1e1e);

		// Setup camera
		const width = container.clientWidth || 800;
		const height = container.clientHeight || 600;
		this.camera = new THREE.PerspectiveCamera(
			75,
			width / height,
			0.1,
			2000
		);
		this.camera.position.set(0, 0, 500);

		// Setup renderer
		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setSize(width, height);
		this.renderer.setPixelRatio(window.devicePixelRatio);
		container.appendChild(this.renderer.domElement);

		// Setup controls
		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.05;
		this.controls.minDistance = 50;
		this.controls.maxDistance = 1000;

		// Setup raycaster for mouse interaction
		this.raycaster = new THREE.Raycaster();
		this.mouse = new THREE.Vector2();

		// Add lights
		const ambientLight = new THREE.AmbientLight(0x404040, 2);
		this.scene.add(ambientLight);

		const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
		directionalLight.position.set(100, 100, 100);
		this.scene.add(directionalLight);

		const pointLight = new THREE.PointLight(0xffffff, 0.5);
		pointLight.position.set(-100, -100, 100);
		this.scene.add(pointLight);

		// Add fog for depth perception
		this.scene.fog = new THREE.Fog(0x1e1e1e, 200, 1000);

		// Setup click handler
		this.renderer.domElement.addEventListener('click', this.handleClick.bind(this));
		this.renderer.domElement.addEventListener('mousemove', this.handleMouseMove.bind(this));

		// Start render loop
		this.animate();
	}

	/**
	 * Render the graph data in 3D
	 */
	renderGraph (data: GraphData, d3Force3d: any): void {
		// Clear existing
		this.clear();

		// Create node spheres
		const sphereGeometry = new THREE.SphereGeometry(8, 32, 32);

		data.nodes.forEach(node => {
			const color = this.getColorForDepth(node.depth);
			const material = new THREE.MeshPhongMaterial({
				color: color,
				shininess: 100,
				specular: 0x111111
			});

			// Root nodes get a glow effect
			if (node.isRoot) {
				material.emissive = new THREE.Color(0x8B0000);
				material.emissiveIntensity = 0.3;
			}

			const sphere = new THREE.Mesh(sphereGeometry, material);
			sphere.position.set(node.x || 0, node.y || 0, (node as any).z || 0);
			sphere.userData = { node };

			// Add label
			this.addLabel(sphere, node.name);

			this.scene.add(sphere);
			this.nodeMeshes.set(node.id, sphere);
		});

		// Create link lines
		const lineMaterial = new THREE.LineBasicMaterial({
			color: 0x888888,
			transparent: true,
			opacity: 0.6
		});

		data.links.forEach(link => {
			const geometry = new THREE.BufferGeometry();
			const positions = new Float32Array([
				0, 0, 0,
				0, 0, 0
			]);
			geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
			const line = new THREE.Line(geometry, lineMaterial);
			this.scene.add(line);
			this.linkLines.push({ line, link } as any);
		});

		// Setup 3D force simulation
		if (d3Force3d) {
			this.simulation = d3Force3d
				.forceSimulation(data.nodes)
				.force('charge', d3Force3d.forceManyBody().strength(-100))
				.force('link', d3Force3d.forceLink(data.links).id((d: any) => d.id).distance(100))
				.force('center', d3Force3d.forceCenter(0, 0, 0))
				.on('tick', () => this.updatePositions(data));
		}
	}

	/**
	 * Add text label to a node
	 */
	private addLabel (mesh: THREE.Mesh, text: string): void {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;
		canvas.width = 256;
		canvas.height = 64;

		ctx.font = 'bold 24px Arial';
		ctx.fillStyle = 'white';
		ctx.textAlign = 'center';
		ctx.fillText(text, 128, 40);

		const texture = new THREE.CanvasTexture(canvas);
		const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
		const sprite = new THREE.Sprite(spriteMaterial);
		sprite.position.set(0, 20, 0);
		sprite.scale.set(40, 10, 1);

		mesh.add(sprite);
	}

	/**
	 * Update positions from simulation
	 */
	private updatePositions (data: GraphData): void {
		// Update node positions
		data.nodes.forEach(node => {
			const mesh = this.nodeMeshes.get(node.id);
			if (mesh) {
				mesh.position.set(
					node.x || 0,
					node.y || 0,
					(node as any).z || 0
				);
			}
		});

		// Update link positions
		this.linkLines.forEach(({ line, link }: any) => {
			const positions = line.geometry.attributes.position.array as Float32Array;
			positions[0] = link.source.x || 0;
			positions[1] = link.source.y || 0;
			positions[2] = (link.source as any).z || 0;
			positions[3] = link.target.x || 0;
			positions[4] = link.target.y || 0;
			positions[5] = (link.target as any).z || 0;
			line.geometry.attributes.position.needsUpdate = true;
		});
	}

	/**
	 * Handle click events
	 */
	private handleClick (event: MouseEvent): void {
		const rect = this.renderer.domElement.getBoundingClientRect();
		this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		this.raycaster.setFromCamera(this.mouse, this.camera);
		const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshes.values()));

		if (intersects.length > 0) {
			const node = intersects[0].object.userData.node;
			if (node && this.onNodeClick) {
				this.onNodeClick(node);
			}
		}
	}

	/**
	 * Handle mouse move for hover effects
	 */
	private handleMouseMove (event: MouseEvent): void {
		const rect = this.renderer.domElement.getBoundingClientRect();
		this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		this.raycaster.setFromCamera(this.mouse, this.camera);
		const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshes.values()));

		// Reset all emissive
		this.nodeMeshes.forEach(mesh => {
			const material = mesh.material as THREE.MeshPhongMaterial;
			if (mesh.userData.node.isRoot) {
				material.emissiveIntensity = 0.3;
			} else {
				material.emissiveIntensity = 0;
			}
		});

		// Highlight hovered
		if (intersects.length > 0) {
			const mesh = intersects[0].object as THREE.Mesh;
			const material = mesh.material as THREE.MeshPhongMaterial;
			material.emissiveIntensity = 0.5;
			this.container.style.cursor = 'pointer';
		} else {
			this.container.style.cursor = 'default';
		}
	}

	/**
	 * Animation loop
	 */
	private animate (): void {
		this.animationId = requestAnimationFrame(() => this.animate());
		this.controls.update();
		this.renderer.render(this.scene, this.camera);
	}

	/**
	 * Get color based on node depth
	 */
	private getColorForDepth (depth: number): number {
		const colors = [
			0x4e79a7, // blue
			0xf28e2c, // orange
			0xe15759, // red
			0x76b7b2, // teal
			0x59a14f, // green
			0xedc949, // yellow
			0xaf7aa1, // purple
			0xff9da7, // pink
			0x9c755f, // brown
			0xbab0ab  // gray
		];
		return colors[depth % colors.length];
	}

	/**
	 * Clear all objects from scene
	 */
	private clear (): void {
		this.nodeMeshes.forEach(mesh => {
			this.scene.remove(mesh);
			mesh.geometry.dispose();
			(mesh.material as THREE.Material).dispose();
		});
		this.nodeMeshes.clear();

		this.linkLines.forEach(({ line }: any) => {
			this.scene.remove(line);
			line.geometry.dispose();
		});
		this.linkLines = [];

		if (this.simulation) {
			this.simulation.stop();
			this.simulation = null;
		}
	}

	/**
	 * Resize renderer
	 */
	resize (width: number, height: number): void {
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(width, height);
	}

	/**
	 * Set click handler
	 */
	setOnNodeClick (handler: (node: any) => void): void {
		this.onNodeClick = handler;
	}

	/**
	 * Dispose and cleanup
	 */
	dispose (): void {
		if (this.animationId) {
			cancelAnimationFrame(this.animationId);
		}
		this.clear();
		this.controls.dispose();
		this.renderer.dispose();
		if (this.renderer.domElement.parentNode) {
			this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
		}
	}
}