Pop.Include('PopEngineCommon/PopMath.js');
Pop.Include('PopEngineCommon/PopPly.js');
Pop.Include('PopEngineCommon/PopObj.js');
Pop.Include('PopEngineCommon/PopCollada.js');
Pop.Include('PopEngineCommon/PopCinema4d.js');
Pop.Include('PopEngineCommon/PopTexture.js');
Pop.Include('PopEngineCommon/PopCamera.js');
Pop.Include('PopEngineCommon/ParamsWindow.js');
Pop.Include('PopEngineCommon/PopFrameCounter.js');

//Pop.Include('AssetManager.js');
Pop.Include('AudioManager.js');
//	already included
//Pop.Include('Timeline.js');
//Pop.Include('Animals.js');

const ParticleColorShader = Pop.LoadFileAsString('ParticleColour.frag.glsl');
const GeoVertShader = Pop.LoadFileAsString('Geo.vert.glsl');
const ColourFragShader = Pop.LoadFileAsString('Colour.frag.glsl');
const EdgeFragShader = Pop.LoadFileAsString('Edge.frag.glsl');

const AnimalParticleVertShader = Pop.LoadFileAsString('AnimalParticle.vert.glsl');
const AnimalParticleFragShader = Pop.LoadFileAsString('AnimalParticle.frag.glsl');

//	temp turning off and just having dummy actors
const LoadWaterAsInstances = true;
const LoadDebrisAsInstances = true;
const PhysicsEnabled = true;
var PhsyicsUpdateCount = 0;	//	gotta do one

var Debug_HighlightActors = [];

const AutoTriangleMeshCount = 100000;//512*512;


function SetupFileAssets()
{
	AssetFetchFunctions['AutoTriangleMesh'] = function(RenderTarget)	{	return GetAutoTriangleMesh( RenderTarget, AutoTriangleMeshCount );	};
}
SetupFileAssets();




function UnrollHexToRgb(Hexs)
{
	let Rgbs = [];
	let PushRgb = function(Hex)
	{
		let Rgb = Pop.Colour.HexToRgb(Hex);
		Rgbs.push( Rgb[0]/255 );
		Rgbs.push( Rgb[1]/255 );
		Rgbs.push( Rgb[2]/255 );
	}
	Hexs.forEach( PushRgb );
	return Rgbs;
}

//	colours from colorbrewer2.org
const OceanColoursHex = ['#c9e7f2','#4eb3d3','#2b8cbe','#0868ac','#084081','#023859','#03658c','#218da6','#17aebf','#15bfbf'];
const DebrisColoursHex = ['#084081','#0868ac'];
//const OceanColoursHex = ['#f7fcf0','#e0f3db','#ccebc5','#a8ddb5','#7bccc4','#4eb3d3','#2b8cbe','#0868ac','#084081'];
const OceanColours = UnrollHexToRgb(OceanColoursHex);
const FogColour = Pop.Colour.HexToRgbf(0x000000);
const LightColour = [0.86,0.95,0.94];

const DebrisColours = UnrollHexToRgb(DebrisColoursHex);

let DebugCamera = new Pop.Camera();
DebugCamera.Position = [ 0,0,0 ];
DebugCamera.LookAt = [ 0,0,-1 ];
DebugCamera.FarDistance = 300;	//	try not to clip anythig in debug mode



function LoadTimeline(Filename)
{
	const Contents = Pop.LoadFileAsString(Filename);
	const FileKeyframes = JSON.parse( Contents );
	const Keyframes = [];
	const PushKeyframe = function(KeyframeTimeKey)
	{
		const Uniforms = FileKeyframes[KeyframeTimeKey];
		const KeyframeTime = parseFloat(KeyframeTimeKey);
		if ( isNaN(KeyframeTime) )
			throw "Key in timeline is not a float: " + KeyframeTimeKey;
		const Keyframe = new TKeyframe( KeyframeTime, Uniforms );
		Keyframes.push( Keyframe );
	}
	Object.keys(FileKeyframes).forEach( PushKeyframe );
	const Timeline = new TTimeline( Keyframes );
	return Timeline;
}







//	scene!


var DebrisMeta = {};
DebrisMeta.Filename = '.random';
DebrisMeta.Position = [0,0,0];
DebrisMeta.Scale = 1;
DebrisMeta.TriangleScale = 0.052015;	//	0.0398
DebrisMeta.Colours = DebrisColours;
DebrisMeta.VertexSkip = 0;

var OceanFilenames = [];
for ( let i=1;	i<=96;	i++ )
	OceanFilenames.push('Ocean/ocean_pts.' + (''+i).padStart(4,'0') + '.ply');

var OceanMeta = {};
OceanMeta.Filename = OceanFilenames;
OceanMeta.Position = [0,0,0];
OceanMeta.Scale = 1.0;
OceanMeta.TriangleScale = 0.0148;
OceanMeta.Colours = OceanColours;

var OceanActors = [];
var DebrisActors = [];

var AppTime = null;
var Hud = {};
var AudioManager = new TAudioManager( GetAudioGetCrossFadeDuration );


var LastMouseRay = null;	//	gr: this isn't getting updated any more
var LastMouseRayUv = null;
var LastMouseClicks = [];	//	array of queued uvs


var RenderFrameCounter = new Pop.FrameCounter();



function IsActorSelectable(Actor)
{
	if ( !Actor.Name )
		return false;
	
	const SelectableNames = ['Animal','Bigbang'];
	const Match = SelectableNames.some( MatchName => Actor.Name.includes(MatchName) );
	if ( !Match )
		return false;

	return true;
}

//	move this to TActor once everything derives from it
function GetActorWorldBoundingBox(Actor)
{
	const LocalTransform = Actor.GetLocalToWorldTransform();
	const Scale = Math.GetMatrixScale( LocalTransform );
	const BoundingBoxLocal = Actor.GetBoundingBox();
	const Position = Math.GetMatrixTranslation( LocalTransform );
	
	//	todo: we should mult without rotating, or rotate and then get new min/max
	const BoundingBoxWorld = {};
	BoundingBoxWorld.Min = Math.Multiply3( BoundingBoxLocal.Min, Scale );
	BoundingBoxWorld.Max = Math.Multiply3( BoundingBoxLocal.Max, Scale );

	BoundingBoxWorld.Min = Math.Add3( BoundingBoxWorld.Min, Position );
	BoundingBoxWorld.Max = Math.Add3( BoundingBoxWorld.Max, Position );

	return BoundingBoxWorld;
}

function GetActorWorldBoundingBoxCorners(Actor,IncludeBothX=true,IncludeBothY=true,IncludeBothZ=true)
{
	const BoundingBoxWorld = GetActorWorldBoundingBox(Actor);
	const Corners = [];
	const Min = BoundingBoxWorld.Min;
	const Max = BoundingBoxWorld.Max;
	
	//	save some processing time by only including things we need
	if ( IncludeBothZ && !IncludeBothX && !IncludeBothY )
	{
		const Mid = Math.Lerp3( Min, Max, 0.5 );
		Corners.push( [Mid[0], Mid[1], Min[2]] );
		Corners.push( [Mid[0], Mid[1], Max[2]] );
		return Corners;
	}
	
	Corners.push( [Min[0], Min[1], Min[2]] );
	Corners.push( [Max[0], Min[1], Min[2]] );
	Corners.push( [Max[0], Max[1], Min[2]] );
	Corners.push( [Min[0], Max[1], Min[2]] );
	Corners.push( [Min[0], Min[1], Max[2]] );
	Corners.push( [Max[0], Min[1], Max[2]] );
	Corners.push( [Max[0], Max[1], Max[2]] );
	Corners.push( [Min[0], Max[1], Max[2]] );
	
	return Corners;
}

function GetIntersectingActors(Ray,Scene)
{
	const Intersections = [];
	
	function TestIntersecting(Actor)
	{
		if ( !IsActorSelectable(Actor) )
			return;
		
		const BoundingBox = GetActorWorldBoundingBox( Actor );
		const IntersectionPos = Math.GetIntersectionRayBox3( Ray.Start, Ray.Direction, BoundingBox.Min, BoundingBox.Max );
		if ( !IntersectionPos )
			return;
		
		let Intersection = {};
		Intersection.Position = IntersectionPos;
		Intersection.Actor = Actor;
		Intersections.push( Intersection );
	}
	Scene.forEach( TestIntersecting );
	
	return Intersections;
}


function GetMouseRay(uv)
{
	let ScreenRect = Window.GetScreenRect();
	let Aspect = ScreenRect[2] / ScreenRect[3];
	let x = Math.lerp( -Aspect, Aspect, uv[0] );
	let y = Math.lerp( 1, -1, uv[1] );
	const ViewRect = [-1,-1,1,1];
	let Time = Params.TimelineYear;
	//	get ray
	const Camera = Params.MouseRayOnTimelineCamera ? GetTimelineCamera() : GetRenderCamera();
	const RayDistance = Params.TestRayDistance;
	
	let ScreenToCameraTransform = Camera.GetProjectionMatrix( ViewRect );
	ScreenToCameraTransform = Math.MatrixInverse4x4( ScreenToCameraTransform );
	
	let StartMatrix = Math.CreateTranslationMatrix( x, y, 0.1 );
	let EndMatrix = Math.CreateTranslationMatrix( x, y, RayDistance );
	StartMatrix = Math.MatrixMultiply4x4( ScreenToCameraTransform, StartMatrix );
	EndMatrix = Math.MatrixMultiply4x4( ScreenToCameraTransform, EndMatrix );
	
	StartMatrix = Math.MatrixMultiply4x4( Camera.GetLocalToWorldMatrix(), StartMatrix );
	EndMatrix = Math.MatrixMultiply4x4( Camera.GetLocalToWorldMatrix(), EndMatrix );

	const Ray = {};
	Ray.Start = Math.GetMatrixTranslation( StartMatrix, true );
	Ray.End = Math.GetMatrixTranslation( EndMatrix, true );
	Ray.Direction = Math.Normalise3( Math.Subtract3( Ray.End, Ray.Start ) );
	
	return Ray;
}

//	returns signed distance, so if negative, point is behind plane.
Math.GetDistanceToPlane = function(Plane4,Position3)
{
	//	plane should be normalised
	const Distance = Math.Dot3( Position3, Plane4 ) + Plane4[3];
	return Distance;
	/*
	// n must be normalized
	return dot(p,n.xyz) + n.w;
	
	const a = Plane4[0];
	const b = Plane4[1];
	const c = Plane4[2];
	const d = Plane4[3];
	const x = Position3[0];
	const y = Position3[1];
	const z = Position3[2];
	const Distance = (a * x + b * y + c * z + d);
	return Distance;
	*/
}

Math.InsideMinusOneToOne = function(f)
{
	return ( f>=-1 && f<= 1 );
}

//	return the filter function
function GetCameraActorCullingFilter(Camera,Viewport)
{
	//	get a matrix to convert world space to camera frustum space (-1..1)
	const WorldToFrustum = Camera.GetWorldToFrustumTransform(Viewport);
	
	const IsVisibleFunction = function(Actor)
	{
		const TestBounds = true;
		
		const IsWorldPositionVisible = function(WorldPosition)
		{
			//const WorldPosition = Math.GetMatrixTranslation( ActorTransform, true );
			const ActorInWorldMtx = Math.CreateTranslationMatrix( ...WorldPosition );
			const ActorInFrustumMtx = Math.MatrixMultiply4x4( WorldToFrustum, ActorInWorldMtx );
			const ActorInFrustumPos = Math.GetMatrixTranslation( ActorInFrustumMtx, true );
			
			if ( Params.FrustumCullTestX && !Math.InsideMinusOneToOne( ActorInFrustumPos[0] ) )	return false;
			if ( Params.FrustumCullTestY && !Math.InsideMinusOneToOne( ActorInFrustumPos[1] ) )	return false;
			if ( Params.FrustumCullTestZ && !Math.InsideMinusOneToOne( ActorInFrustumPos[2] ) )	return false;
			
			return true;
		}
		
		if ( TestBounds )
		{
			const WorldBoundsCorners = GetActorWorldBoundingBoxCorners( Actor, Params.FrustumCullTestX, Params.FrustumCullTestY, Params.FrustumCullTestZ );
			return WorldBoundsCorners.some( IsWorldPositionVisible );
		}
		else
		{
			const ActorTransform = Actor.GetLocalToWorldTransform();
			const ActorPosition = Math.GetMatrixTranslation( ActorTransform );
			return IsWorldPositionVisible( ActorPosition );
		}
		
	}

	return IsVisibleFunction;
}

function QueueSceneClick(x,y)
{
	const Rect = Window.GetScreenRect();
	const u = x / Rect[2];
	const v = y / Rect[3];
	LastMouseClicks.push( [u,v] );
}

function UpdateMouseMove(x,y)
{
	const Rect = Window.GetScreenRect();
	const u = x / Rect[2];
	const v = y / Rect[3];
	const CameraScreenUv = [u,v];
	LastMouseRayUv = CameraScreenUv;
	
	Debug_HighlightActors = GetActorIntersections(CameraScreenUv);
	if ( Debug_HighlightActors.length )
	{
		const Names = Debug_HighlightActors.map( a => a.Actor.Name );
		//Pop.Debug("Selected actors;", Names );
	}
}


function GetActorIntersections(CameraScreenUv)
{
	const Rect = Window.GetScreenRect();
	
	//Pop.Debug(CameraScreenUv);
	const Time = Params.TimelineYear;
	const Viewport = [0,0,Rect[2],Rect[3]];
	const Camera = GetTimelineCamera();
	
	const Ray = GetMouseRay( CameraScreenUv );
	
	//const IsActorVisible = GetCameraActorCullingFilter( Camera, Viewport );
	const IsActorVisible = function(Actor)
	{
		if ( Actor.IsVisible === undefined )
			return true;
		return Actor.IsVisible === true;
	}
	const FilterActor = function(Actor)
	{
		if ( !IsActorSelectable(Actor) )
			return false;
		if ( !IsActorVisible(Actor) )
			return false;
		return true;
	}
	
	//	find actor
	const Scene = GetActorScene( Time, FilterActor );
	const SelectedActors = GetIntersectingActors( Ray, Scene );
	
	return SelectedActors;
}



const TimelineMinYear = 1800;
const TimelineMinInteractiveYear = 1860;
const TimelineMaxYear = 2100;
const TimelineMaxInteractiveYear = 2100;

Params.TimelineYear = TimelineMinYear;
Params.ExperienceDurationSecs = 240;
Params.ShowAnimal_ExplodeSecs = 3;
Params.ShowAnimal_Duration = 6;
Params.ShowAnimal_CameraOffsetX = 0.32;
Params.ShowAnimal_CameraOffsetY = 0.44;
Params.ShowAnimal_CameraOffsetZ = 3.52;
Params.ShowAnimal_CameraLerpInSpeed = 0.275;
Params.ShowAnimal_CameraLerpOutSpeed = 0.10;

Params.AnimalBufferLod = 1.0;
Params.DebugCullTimelineCamera = true;
Params.TransposeFrustumPlanes = false;
Params.FrustumCullTestX = false;	//	re-enable when we cull on bounding box
Params.FrustumCullTestY = false;	//	re-enable when we cull on bounding box
Params.FrustumCullTestZ = true;
Params.MouseRayOnTimelineCamera = false;
Params.TestRaySize = 0.39;
Params.PhysicsAnimalNoiseScale = 9.9;
Params.PhysicsAnimalDamping = 0.01;
Params.PhysicsDebrisNoiseScale = 0.9;
Params.PhysicsDebrisDamping = 0.04;
Params.DrawTestRay = false;
Params.TestRayDistance = 0.82;
Params.ExperiencePlaying = true;
Params.AutoGrabDebugCamera = false;
Params.UseDebugCamera = false;
Params.EnableMusic = true;
Params.DebugCameraPositionCount = 0;
Params.DebugCameraPositionScale = 0.15;
Params.FogMinDistance = 8.0;
Params.FogMaxDistance = 20.0;
Params.FogColour = FogColour;
Params.LightColour = LightColour;
Params.Animal_TriangleScale = 0.01;
Params.Ocean_TriangleScale = OceanMeta.TriangleScale;
Params.Debris_TriangleScale = DebrisMeta.TriangleScale;
Params.DebugPhysicsTextures = false;
Params.BillboardTriangles = true;
Params.ShowClippedParticle = false;
Params.CameraNearDistance = 0.1;
Params.CameraFarDistance = 24;	//	under 20 and keeps clipping too easily
Params.AudioCrossFadeDurationSecs = 2;
Params.OceanAnimationFrameRate = 60;
Params.DrawBoundingBoxes = false;
Params.DrawBoundingBoxesFilled = false;
Params.ScrollFlySpeed = 50;

let OnParamsChanged = function(Params,ChangedParamName)
{
	OceanActors.forEach( a => a.Meta.TriangleScale = Params.Ocean_TriangleScale );
	DebrisActors.forEach( a => a.Meta.TriangleScale = Params.Debris_TriangleScale );

	if ( ChangedParamName == 'UseDebugCamera' && Params.UseDebugCamera )
		OnSwitchedToDebugCamera();
}

let ParamsWindow = {};
ParamsWindow.OnParamChanged = function(){};

if ( IsDebugEnabled() )
{
	const ParamsWindowRect = [800,20,350,200];
	ParamsWindow = new CreateParamsWindow(Params,OnParamsChanged,ParamsWindowRect);
	ParamsWindow.AddParam('TimelineYear',TimelineMinYear,TimelineMaxYear);	//	can no longer clean as we move timeline in float
	ParamsWindow.AddParam('ExperienceDurationSecs',30,600);
	ParamsWindow.AddParam('AnimalBufferLod',0,1);
	ParamsWindow.AddParam('PhysicsAnimalNoiseScale',0,10);
	ParamsWindow.AddParam('PhysicsAnimalDamping',0,1);
	ParamsWindow.AddParam('PhysicsDebrisNoiseScale',0,10);
	ParamsWindow.AddParam('PhysicsDebrisDamping',0,1);
	ParamsWindow.AddParam('ExperiencePlaying');
	ParamsWindow.AddParam('ShowAnimal_ExplodeSecs',0,20);
	ParamsWindow.AddParam('ShowAnimal_Duration',0,20);
	ParamsWindow.AddParam('ShowAnimal_CameraOffsetX',-10,10);
	ParamsWindow.AddParam('ShowAnimal_CameraOffsetY',-10,10);
	ParamsWindow.AddParam('ShowAnimal_CameraOffsetZ',-10,10);
	ParamsWindow.AddParam('ShowAnimal_CameraLerpInSpeed',0,1);
	ParamsWindow.AddParam('ShowAnimal_CameraLerpOutSpeed',0,1);

	ParamsWindow.AddParam('AutoGrabDebugCamera');
	ParamsWindow.AddParam('UseDebugCamera');
	ParamsWindow.AddParam('FogColour','Colour');
	ParamsWindow.AddParam('LightColour','Colour');
	ParamsWindow.AddParam('Animal_TriangleScale',0,0.2);
	ParamsWindow.AddParam('Ocean_TriangleScale',0,0.2);
	ParamsWindow.AddParam('Debris_TriangleScale',0,0.2);
	ParamsWindow.AddParam('FogMinDistance',0,50);
	ParamsWindow.AddParam('FogMaxDistance',0,50);
	ParamsWindow.AddParam('EnableMusic');
	ParamsWindow.AddParam('DrawBoundingBoxes');
	ParamsWindow.AddParam('DrawBoundingBoxesFilled');
	ParamsWindow.AddParam('AudioCrossFadeDurationSecs',0,10);
	ParamsWindow.AddParam('OceanAnimationFrameRate',1,60);

	ParamsWindow.AddParam('DebugCameraPositionCount',0,200,Math.floor);
	ParamsWindow.AddParam('DebugCameraPositionScale',0,1);

	ParamsWindow.AddParam('DebugCullTimelineCamera');
	ParamsWindow.AddParam('FrustumCullTestX');
	ParamsWindow.AddParam('FrustumCullTestY');
	ParamsWindow.AddParam('FrustumCullTestZ');
	ParamsWindow.AddParam('MouseRayOnTimelineCamera');
	ParamsWindow.AddParam('TestRayDistance',-1,1);
	ParamsWindow.AddParam('TestRaySize',0,10);
	ParamsWindow.AddParam('DrawTestRay');
	ParamsWindow.AddParam('EnablePhysicsIteration');
	ParamsWindow.AddParam('DebugPhysicsTextures');
	ParamsWindow.AddParam('BillboardTriangles');
	ParamsWindow.AddParam('ShowClippedParticle');
	ParamsWindow.AddParam('CameraNearDistance', 0.01, 10);
	ParamsWindow.AddParam('CameraFarDistance', 1, 100);
	ParamsWindow.AddParam('ScrollFlySpeed',1,300);
}




function RenderTriangleBufferActor(RenderTarget,Actor,ActorIndex,SetGlobalUniforms,Time)
{
	if ( !Actor )
		return;
	
	const PositionsTexture = Actor.GetPositionsTexture();
	const VelocitysTexture = Actor.GetVelocitysTexture();
	const BlitShader = Pop.GetShader( RenderTarget, BlitCopyShader, QuadVertShader );
	const Shader = Pop.GetShader( RenderTarget, ParticleColorShader, ParticleTrianglesVertShader );
	const TriangleBuffer = Actor.GetTriangleBuffer(RenderTarget);
	
	
	//let Geo = GetAsset( Actor.Geometry, RenderTarget );
	//let Shader = Pop.GetShader( RenderTarget, Actor.FragShader, Actor.VertShader );
	const LocalPositions = [ -1,-1,0,	1,-1,0,	0,1,0	];

	let SetUniforms = function(Shader)
	{
		SetGlobalUniforms( Shader );

		Shader.SetUniform('LocalToWorldTransform', Actor.GetLocalToWorldTransform() );
		Shader.SetUniform('LocalPositions', LocalPositions );
		Shader.SetUniform('BillboardTriangles', Params.BillboardTriangles );
		Shader.SetUniform('WorldPositions',PositionsTexture);
		Shader.SetUniform('WorldPositionsWidth',PositionsTexture.GetWidth());
		Shader.SetUniform('WorldPositionsHeight',PositionsTexture.GetHeight());
		Shader.SetUniform('TriangleScale', Actor.Meta.TriangleScale);
		Shader.SetUniform('Colours',Actor.Colours);
		Shader.SetUniform('ColourCount',Actor.Colours.length/3);
	};
	
	RenderTarget.DrawGeometry( TriangleBuffer, Shader, SetUniforms );
	
	
	if ( Params.DebugPhysicsTextures )
	{
		let w = 0.2;
		let x = ActorIndex * (w * 1.05);
		let Quad = GetQuadGeometry(RenderTarget);
		let SetDebugPositionsUniforms = function(Shader)
		{
			Shader.SetUniform('VertexRect', [x, 0, w, 0.25 ] );
			Shader.SetUniform('Texture',PositionsTexture);
		};
		let SetDebugVelocitysUniforms = function(Shader)
		{
			Shader.SetUniform('VertexRect', [x, 0.3, w, 0.25 ] );
			Shader.SetUniform('Texture',VelocitysTexture);
		};
	
		if ( PositionsTexture )
			RenderTarget.DrawGeometry( Quad, BlitShader, SetDebugPositionsUniforms );
		if ( VelocitysTexture )
			RenderTarget.DrawGeometry( Quad, BlitShader, SetDebugVelocitysUniforms );
	}
}


function SetupAnimalTextureBufferActor(Filename,BoundingBox)
{
	this.Geometry = 'AutoTriangleMesh';
	this.VertShader = AnimalParticleVertShader;
	this.FragShader = AnimalParticleFragShader;
	
	this.TextureBuffers = null;
	this.Colours = [0,1,0];
	this.BoundingBox = BoundingBox;
	
	this.UpdateVelocityShader = ParticlePhysicsIteration_UpdateVelocity;
	this.UpdatePositionShader = ParticlePhysicsIteration_UpdatePosition;
	this.UpdatePhysics = false;

	this.ResetPhysicsTextures = function()
	{
		if ( !this.TextureBuffers )
			throw "Not ready to setup physics yet, no texture buffers";
		
		this.PositionTexture = this.TextureBuffers.PositionTexture;
		//Pop.Debug("ResetPhysicsTextures", JSON.stringify(this) );
		//	need to init these to zero?
		let Size = [ this.PositionTexture.GetWidth(), this.PositionTexture.GetHeight() ];
		this.VelocityTexture = new Pop.Image(Size,'Float3');
		this.ScratchTexture = new Pop.Image(Size,'Float3');
		this.PositionOrigTexture = new Pop.Image();
		this.PositionOrigTexture.Copy( this.PositionTexture );
	}
	
	this.PhysicsIteration = function(DurationSecs,Time,RenderTarget,SetPhysicsUniforms)
	{
		if ( !this.UpdatePhysics )
			return;

		if ( !this.VelocityTexture )
		{
			this.ResetPhysicsTextures();
		}
		
		const SetAnimalPhysicsUniforms = function(Shader)
		{
			SetPhysicsUniforms(Shader);
			Shader.SetUniform('NoiseScale', Params.PhysicsAnimalNoiseScale );
			Shader.SetUniform('Damping', Params.PhysicsAnimalDamping );
		}
		
		PhysicsIteration( RenderTarget, Time, this.PositionTexture, this.VelocityTexture, this.ScratchTexture, this.PositionOrigTexture, this.UpdateVelocityShader, this.UpdatePositionShader, SetAnimalPhysicsUniforms );
	}
	
	this.Render = function(RenderTarget, ActorIndex, SetGlobalUniforms, Time)
	{
		const GetIndexMap = undefined;
		const ScaleBounds = undefined;
		const MaxPositions = AutoTriangleMeshCount;
		
		const Actor = this;
		//	gr: does this NEED to be in rendertarget area?
		if ( !Actor.TextureBuffers )
			Actor.TextureBuffers = LoadGeometryToTextureBuffers( RenderTarget, Filename, GetIndexMap, ScaleBounds, MaxPositions );
		
		const Geo = GetAsset( this.Geometry, RenderTarget );
		const Shader = Pop.GetShader( RenderTarget, this.FragShader, this.VertShader );
		const LocalPositions = [ -1,-1,0,	1,-1,0,	0,1,0	];
		const PositionTexture = this.TextureBuffers.PositionTexture;
		const ColourTexture = this.TextureBuffers.ColourTexture;
		const AlphaTexture = this.TextureBuffers.AlphaTexture;
		const LocalToWorldTransform = this.LocalToWorldTransform;
		
		
		const SetUniforms = function(Shader)
		{
			SetGlobalUniforms( Shader );
			Shader.SetUniform('ShowClippedParticle', Params.ShowClippedParticle );
			Shader.SetUniform('LocalToWorldTransform', LocalToWorldTransform );
			Shader.SetUniform('LocalPositions', LocalPositions );
			Shader.SetUniform('BillboardTriangles', Params.BillboardTriangles );
			Shader.SetUniform('WorldPositions',PositionTexture);
			Shader.SetUniform('WorldPositionsWidth',PositionTexture.GetWidth());
			Shader.SetUniform('WorldPositionsHeight',PositionTexture.GetHeight());
			Shader.SetUniform('TriangleScale', Params.Animal_TriangleScale );
			if ( ColourTexture )
			{
				Shader.SetUniform('ColourImage',ColourTexture);
				Shader.SetUniform('ColourImageValid', true );
			}
			else
			{
				Shader.SetUniform('ColourImageValid', false );
			}
		}
		
		//	limit number of triangles
		//	gr: why is this triangle count so much bigger than the buffer?
		let TriangleCount = Math.min( AutoTriangleMeshCount, Actor.TextureBuffers.TriangleCount );
		TriangleCount *= Params.AnimalBufferLod;
		RenderTarget.DrawGeometry( Geo, Shader, SetUniforms, TriangleCount );
	}

}



function LoadCameraScene(Filename)
{
	let Scene = [];
	
	let OnActor = function(ActorNode)
	{
		if ( LoadWaterAsInstances )
		{
			if ( ActorNode.Name.startsWith('Ocean_surface_') )
			{
				let Meta = Object.assign({}, OceanMeta );
				Meta.PhysicsUpdateEnabled = true;
				Meta.Position = ActorNode.Position;
				//Meta.ScaleMeshToBounds = ActorNode.BoundingBox;
				
				let Actor = new TAnimatedActor( OceanMeta );
				Actor.BoundingBox = ActorNode.BoundingBox;
				//	gr: why isn't this loading in meta for animated actor
				Actor.Position = ActorNode.Position;
				OceanActors.push( Actor );
				//Scene.push( Actor );
				return;
			}
		}
		
		if ( LoadDebrisAsInstances )
		{
			if ( ActorNode.Name.startsWith('Water_') )
			{
				let Meta = Object.assign({}, DebrisMeta );
				Meta.PhysicsUpdateEnabled = true;
				Meta.Position = ActorNode.Position;
				Meta.ScaleMeshToBounds = ActorNode.BoundingBox;
				
				let Actor = new TPhysicsActor( Meta );
				Actor.BoundingBox = ActorNode.BoundingBox;
				DebrisActors.push( Actor );
				//Scene.push( Actor );
				return;
			}
		}
		
		Pop.Debug("Loading actor", ActorNode.Name, ActorNode );
		let Actor = new TActor();
		Actor.Name = ActorNode.Name;
		
		//	there are some new objects with no bounding boxes or geo,
		//	but they're not ones we want to turn to animals anyway
		let LoadBufferActor = IsActorSelectable(Actor);
		if ( LoadBufferActor )
		{
			//let LocalScale = ActorNode.Scale;
			let WorldPos = ActorNode.Position;
			Actor.LocalToWorldTransform = Math.CreateTranslationMatrix( ...WorldPos );
			Actor.BoundingBox = ActorNode.BoundingBox;
			const Animal = GetRandomAnimal();
			Actor.Animal = Animal;
			Actor.Name += " " + Animal.Name;
			SetupAnimalTextureBufferActor.call( Actor, Animal.Model, ActorNode.BoundingBox );
		}
		else
		{
			let LocalScale = ActorNode.Scale;
			let WorldPos = ActorNode.Position;
			Actor.Geometry = 'Cube';
			
			//	some nodes have no geometry, so no bounding box
			if ( !ActorNode.BoundingBox )
			{
				ActorNode.BoundingBox = {};
				ActorNode.BoundingBox.Min = [0,0,0];
				ActorNode.BoundingBox.Max = [1,1,1];
			}
			
			const RenderAsBounds = true;
			if ( RenderAsBounds )
			{
				//	undo the bounds scale and render the cube at the bounds scale
				//	but that'll scale bounds too, so undo that (just to 0..1)
				let BoundsCenter = Math.Lerp3( ActorNode.BoundingBox.Max, ActorNode.BoundingBox.Min, 0.5 );
				let BoundsScale = Math.Subtract3( ActorNode.BoundingBox.Max, ActorNode.BoundingBox.Min );
				
				LocalScale = BoundsScale;
				WorldPos = Math.Add3( WorldPos, BoundsCenter );
				ActorNode.BoundingBox.Max = [1,1,1];
				ActorNode.BoundingBox.Min = [0,0,0];
				Pop.Debug( ActorNode.Name, "BoundsScale", BoundsScale, "ActorNode.Scale", ActorNode.Scale );
			}
			
			let LocalScaleMtx = Math.CreateScaleMatrix( ...LocalScale );
			let WorldPosMtx = Math.CreateTranslationMatrix( ...WorldPos );
			
			Actor.LocalToWorldTransform = Math.MatrixMultiply4x4( WorldPosMtx, LocalScaleMtx );
			
			Actor.VertShader = GeoVertShader;
			Actor.FragShader = ColourFragShader;
			Actor.BoundingBox = ActorNode.BoundingBox;
		}
		Scene.push( Actor );
	}
	
	const CachedFilename = GetCachedFilename(Filename,'scene');
	if ( Pop.FileExists(CachedFilename) )
		Filename = CachedFilename;
	const FileScene = LoadSceneFile(Filename);
	
	FileScene.Actors.forEach( OnActor );
	
	const Timeline = new TTimeline( FileScene.Keyframes );
	GetCameraTimelineAndUniform = function()
	{
		return [Timeline,'CameraPosition'];
	}
	
	return Scene;
}


//	default reads from default timeline
let GetCameraTimelineAndUniform = function()
{
	return [Timeline,'Timeline_CameraPosition'];
}

function GetCameraPath()
{
	const TimelineAndUniform = GetCameraTimelineAndUniform();
	const Timeline = TimelineAndUniform[0];
	const CameraUniform = TimelineAndUniform[1];
	const CameraPositions = [];
	for ( let i=0;	i<Params.DebugCameraPositionCount;	i++ )
	{
		let t = i / Params.DebugCameraPositionCount;
		let Year = Math.lerp( TimelineMinYear, TimelineMaxYear, t );
		let Pos = Timeline.GetUniform( Year, CameraUniform );
		CameraPositions.push( Pos );
	}
	return CameraPositions;
}

function GetTimelineCameraPosition(Year)
{
	const TimelineAndUniform = GetCameraTimelineAndUniform();
	const Timeline = TimelineAndUniform[0];
	const CameraUniform = TimelineAndUniform[1];
	let Pos = Timeline.GetUniform( Year, CameraUniform );
	return Pos;
}

function GetTimelineCamera()
{
	let Camera = new Pop.Camera();
	Camera.Position = Acid.GetCameraPosition();
	
	//	camera always faces forward now
	Camera.LookAt = Camera.Position.slice();
	Camera.LookAt[2] -= 1.0;
	
	Camera.NearDistance = Params.CameraNearDistance;
	Camera.FarDistance = Params.CameraFarDistance;
	return Camera;
}

function GetRenderCamera()
{
	if ( Params.UseDebugCamera )
		return DebugCamera;
	
	return GetTimelineCamera();
}

//	todo: use generic actor
function TActor(Transform,Geometry,VertShader,FragShader,Uniforms)
{
	this.LocalToWorldTransform = Transform;
	this.Geometry = Geometry;
	this.VertShader = VertShader;
	this.FragShader = FragShader;
	this.Uniforms = Uniforms || [];
	this.BoundingBox = null;
	
	this.PhysicsIteration = function(DurationSecs,Time,RenderTarget,SetPhysicsUniforms)
	{
	}
	
	this.Render = function(RenderTarget, ActorIndex, SetGlobalUniforms, Time)
	{
		const Geo = GetAsset( this.Geometry, RenderTarget );
		const Shader = Pop.GetShader( RenderTarget, this.FragShader, this.VertShader );
		
		const SetUniforms = function(Shader)
		{
			SetGlobalUniforms( Shader );
			Shader.SetUniform('LocalToWorldTransform', this.LocalToWorldTransform );
		}
		
		RenderTarget.DrawGeometry( Geo, Shader, SetUniforms.bind(this) );
	}
	
	this.GetLocalToWorldTransform = function()
	{
		return this.LocalToWorldTransform;
	}
	
	this.GetBoundingBox = function()
	{
		return this.BoundingBox;
	}
}



//	filter for culling
function GetActorScene(Time,Filter)
{
	let Scene = [];
	Filter = Filter || function(Actor)	{	return true;	};

	let PushPositionBufferActor = function(Actor)
	{
		if ( !Filter(Actor) )
			return;
		
		Actor.Render = function(RenderTarget, ActorIndex, SetGlobalUniforms, Time)
		{
			let Actor = this;
			const PositionsTexture = Actor.GetPositionsTexture(RenderTarget);
			Actor.Uniforms = [];
			Actor.Uniforms['WorldPositions'] = PositionsTexture;
			Actor.Uniforms['WorldPositionsWidth'] = PositionsTexture.GetWidth();
			Actor.Uniforms['WorldPositionsHeight'] = PositionsTexture.GetHeight();
			Actor.Uniforms['TriangleScale']= Actor.Meta.TriangleScale;
			Actor.Uniforms['Colours']= Actor.Colours;
			Actor.Uniforms['ColourCount']= Actor.Colours.length/3;
			
			RenderTriangleBufferActor( RenderTarget, this, ActorIndex, SetGlobalUniforms, Time );
		}
		
		//let a = new TActor( )
		Scene.push( Actor );
	}

	let PushCameraSceneActor = function(Actor)
	{
		if ( !Filter(Actor) )
			return;
		
		Scene.push(Actor)
	}

	OceanActors.forEach( a => PushPositionBufferActor( a ) );
	DebrisActors.forEach( a => PushPositionBufferActor( a ) );
	
	CameraScene.forEach( PushCameraSceneActor );
	
	//Pop.Debug("Scene has x" + Scene.length + " actors");
	
	return Scene;
}


//	get scene graph
function GetRenderScene(Time,VisibleFilter)
{
	let Scene = [];
	
	let PushActorBox = function(LocalToWorldTransform,BoundsMin,BoundsMax,Filled=Params.DrawBoundingBoxesFilled)
	{
		//	bounding box to matrix...
		const BoundsSize = Math.Subtract3( BoundsMax, BoundsMin );
		
		//	cube is currently -1..1 so compensate. Need to change shader if we change this
		BoundsSize[0] /= 2;
		BoundsSize[1] /= 2;
		BoundsSize[2] /= 2;
		
		const BoundsCenter = Math.Lerp3( BoundsMin, BoundsMax, 0.5 );
		let BoundsMatrix = Math.CreateTranslationMatrix(...BoundsCenter);
		BoundsMatrix = Math.MatrixMultiply4x4( BoundsMatrix, Math.CreateScaleMatrix(...BoundsSize) );
		BoundsMatrix = Math.MatrixMultiply4x4( LocalToWorldTransform, BoundsMatrix );
		
		const BoundsActor = new TActor();
		const BoundsLocalScale = []
		BoundsActor.LocalToWorldTransform = BoundsMatrix;
		BoundsActor.Geometry = 'Cube';
		BoundsActor.VertShader = GeoVertShader;
		BoundsActor.FragShader = EdgeFragShader;
		BoundsActor.Uniforms['ChequerFrontAndBack'] = Filled;
		BoundsActor.Uniforms['ChequerSides'] = Filled;
		BoundsActor.Uniforms['LineWidth'] = 0.05;
		
		Scene.push( BoundsActor );
	}
	
	let PushActorBoundingBox = function(Actor,ForceDraw)
	{
		if ( !ForceDraw )
			if ( !Params.DrawBoundingBoxes && !Params.DrawBoundingBoxesFilled )
				return;
		
		//	has no bounds!
		const BoundingBox = Actor.GetBoundingBox();
		if ( !BoundingBox )
		{
			Pop.Debug("Actor has no bounds",Actor);
			return;
		}
		
		PushActorBox( Actor.GetLocalToWorldTransform(), BoundingBox.Min, BoundingBox.Max );
	}
	
	let PushDebugCameraActor = function()
	{
		let Camera = GetTimelineCamera();
		const Actor = new TActor();
		const LocalScale = Params.DebugCameraPositionScale;
		Actor.LocalToWorldTransform = Camera.GetLocalToWorldFrustumTransformMatrix();
		Actor.Geometry = 'Cube';
		Actor.VertShader = GeoVertShader;
		Actor.FragShader = EdgeFragShader;
		Actor.Uniforms['ChequerFrontAndBack'] = true;
		Actor.Uniforms['ChequerSides'] = false;
		Actor.Uniforms['LineWidth'] = 0.01;
		
		Scene.push( Actor );
	}
	
	
	let PushCameraPosActor = function(Position)
	{
		const Actor = new TActor();
		const LocalScale = Params.DebugCameraPositionScale;
		Actor.LocalToWorldTransform = Math.CreateTranslationMatrix(...Position);
		Actor.LocalToWorldTransform = Math.MatrixMultiply4x4( Actor.LocalToWorldTransform, Math.CreateScaleMatrix(LocalScale) );
		Actor.Geometry = 'Cube';
		Actor.VertShader = GeoVertShader;
		Actor.FragShader = ColourFragShader;
		Scene.push( Actor );
	}
	
	const ActorScene = GetActorScene( Time, VisibleFilter );
	ActorScene.forEach( a => PushActorBoundingBox(a) );
	ActorScene.forEach( a => Scene.push(a) );
	
	const CameraPositions = GetCameraPath();
	CameraPositions.forEach( PushCameraPosActor );
	
	if ( Params.UseDebugCamera )
	{
		PushDebugCameraActor();
	}
	
	if ( LastMouseRayUv && Params.DrawTestRay )
	{
		const Ray = GetMouseRay( LastMouseRayUv );
		let RayEnd = Math.CreateTranslationMatrix( ...Ray.End );
		let TestSize = Params.TestRaySize / 2;
		let Min = [-TestSize,-TestSize,-TestSize];
		let Max = [TestSize,TestSize,TestSize];
		PushActorBox( RayEnd, Min, Max, true );
	}
	
	//	draw intersections
	let DrawIntersection = function(Intersection)
	{
		PushActorBoundingBox( Intersection.Actor, true );
		//Pop.Debug("Selected",Intersection.Actor.Name);
		let Pos = Math.CreateTranslationMatrix( ...Intersection.Position );
		let TestSize = Params.TestRaySize / 2;
		let Min = [-TestSize,-TestSize,-TestSize];
		let Max = [TestSize,TestSize,TestSize];
		PushActorBox( Pos, Min, Max, true );
	}
	Debug_HighlightActors.forEach( DrawIntersection );
	
	return Scene;
}


function GetAudioGetCrossFadeDuration()
{
	return Params.AudioCrossFadeDurationSecs;
}

//	need a better place for this, app state!
function Init()
{
	AppTime = 0;
	
	Hud.MusicLabel = new Pop.Hud.Label('AudioMusicLabel');
	Hud.VoiceLabel = new Pop.Hud.Label('AudioVoiceLabel');
	Hud.SubtitleLabel = new Pop.Hud.Label('SubtitleLabel');
	Hud.YearLabel = new Pop.Hud.Label('YearLabel');
	Hud.YearSlider = new Pop.Hud.Slider('YearSlider');
	Hud.YearSlider.SetMinMax( TimelineMinInteractiveYear, TimelineMaxInteractiveYear );
	
	Hud.Stats_Temp = new Pop.Hud.Label('Stats_Temp_Label');
	Hud.Stats_Co2 = new Pop.Hud.Label('Stats_Co2_Label');
	Hud.Stats_Oxygen = new Pop.Hud.Label('Stats_Oxygen_Label');
	Hud.Stats_Ph = new Pop.Hud.Label('Stats_Ph_Label');
	
	Hud.Animal_Card = new Pop.Hud.Label('AnimalCard');
	Hud.Animal_Title = new Pop.Hud.Label('AnimalCard_Title');
	Hud.Animal_Description = new Pop.Hud.Label('AnimalCard_Description');

	Hud.Debug_VisibleActors = new Pop.Hud.Label('Debug_VisibleActors');
	Hud.Debug_RenderedActors = new Pop.Hud.Label('Debug_RenderedActors');
	Hud.Debug_RenderStats = new Pop.Hud.Label('Debug_RenderStats');
	Hud.Debug_FrameRate = new Pop.Hud.Label('Debug_FrameRate');
	
	RenderFrameCounter.Report = function(CountPerSec)
	{
		Hud.Debug_FrameRate.SetValue( CountPerSec.toFixed(2) + " fps" );
	}
}

var Acid = {};

//	use a string if function not yet declared
Acid.State_Fly = 'Fly';
Acid.State_ShowAnimal = 'ShowAnimal';
Acid.StateMap =
{
	'Fly':			Update_Fly,
	'ShowAnimal':	Update_ShowAnimal
};
Acid.StateMachine = new Pop.StateMachine( Acid.StateMap, Acid.State_Fly, Acid.State_Fly, false );
Acid.SelectedActor = null;
Acid.CameraPosition = null;	//	current pos for lerping depending on state
Acid.GetCameraPosition = function()
{
	if ( !Acid.CameraPosition )
		throw "this should have been set before use";
	return Acid.CameraPosition;
}

function GetActorWorldPos(Actor)
{
	const Transform = Actor.GetLocalToWorldTransform();
	return Math.GetMatrixTranslation( Transform );
}

function Update_ShowAnimal(FirstUpdate,FrameDuration,StateTime)
{
	if ( FirstUpdate )
	{
		//	update hud to the current animal
		//	move/offset camera to focus on it
		const Animal = Acid.SelectedActor.Animal;
		if ( !Animal )
			throw "No selected animal";
		
		Hud.Animal_Card.SetVisible(true);
		Hud.Animal_Title.SetValue( Animal.Name );
		Hud.Animal_Description.SetValue( Animal.Description );
	}
	
	
	//	lerp camera to pos
	let TargetCameraPos = GetActorWorldPos(Acid.SelectedActor);
	//	apply offset
	const TargetOffset = [ Params.ShowAnimal_CameraOffsetX, Params.ShowAnimal_CameraOffsetY, Params.ShowAnimal_CameraOffsetZ ];
	TargetCameraPos = Math.Add3( TargetCameraPos, TargetOffset );
	//	move camera
	Acid.CameraPosition = Math.Lerp3( Acid.CameraPosition, TargetCameraPos, Params.ShowAnimal_CameraLerpInSpeed );
	
	
	
	if ( StateTime > Params.ShowAnimal_ExplodeSecs )
	{
		Acid.SelectedActor.UpdatePhysics = true;
	}
	
	if ( StateTime < Params.ShowAnimal_Duration )
		return;
	
	//	hide hud
	Hud.Animal_Card.SetVisible(false);
	
	return Acid.State_Fly;
}


function Update_Fly(FirstUpdate,FrameDuration,StateTime)
{
	if ( FirstUpdate )
	{
		//	init very first camera pos
		if ( !Acid.CameraPosition )
		{
			Acid.CameraPosition = GetTimelineCameraPosition( Params.TimelineYear );
		}
	}
	
	//	move time along
	{
		const ExpYears = TimelineMaxYear - TimelineMinYear;
		const YearsPerSec = ExpYears / Params.ExperienceDurationSecs;
		const YearsPerFrame = FrameDuration * YearsPerSec;
		Params.TimelineYear += YearsPerFrame;
		if ( ParamsWindow )
			ParamsWindow.OnParamChanged('TimelineYear');
	}

	//	move camera
	{
		const TimelineCameraPos = GetTimelineCameraPosition( Params.TimelineYear );
		let TargetCameraPos = TimelineCameraPos;
		Acid.CameraPosition = Math.Lerp3( Acid.CameraPosition, TargetCameraPos, Params.ShowAnimal_CameraLerpOutSpeed );
	}
	
	//	check for animal selection
	let SelectedActor = null;
	//	process clicks
	const ProcessClick = function(uv)
	{
		//	gr: should reuse selected list?
		const IntersectedActors = GetActorIntersections(uv);
		if ( IntersectedActors.length > 0 )
		{
			SelectedActor = IntersectedActors[0].Actor;
		}
	}
	LastMouseClicks.forEach( ProcessClick );
	LastMouseClicks.length = 0;

	if ( SelectedActor )
	{
		Acid.SelectedActor = SelectedActor;
		return Acid.State_ShowAnimal;
	}
	
	//	fly until we reach end of timeline
	if ( Params.TimelineYear >= TimelineMaxInteractiveYear )
		return 'Outro';
	
	//	stay flying
	return null;
}

//	todo: proper app loop, currently triggered from render
function Update(FrameDurationSecs)
{
	if ( AppTime === null )
		Init();
	
	//	update app logic
	Acid.StateMachine.LoopIteration( !Params.ExperiencePlaying );
	
	
	const Time = Params.TimelineYear;
	
	//	update audio
	const CurrentMusic = Timeline.GetUniform( Time, 'Music' );
	AudioManager.SetMusic( Params.EnableMusic ? CurrentMusic : null );
	const CurrentVoice = Timeline.GetUniform( Time, 'VoiceAudio' );
	AudioManager.PlayVoice( CurrentVoice );
	AudioManager.Update( FrameDurationSecs );

	//	update some stuff from timeline
	Params.FogColour = Timeline.GetUniform( Time, 'FogColour' );
	if ( ParamsWindow )
		ParamsWindow.OnParamChanged('FogColour');
	
	//	update hud
	Hud.YearLabel.SetValue( Math.floor(Params.TimelineYear) );
	Hud.YearSlider.SetValue( Params.TimelineYear );
	const MusicDebug = AudioManager.GetMusicQueueDebug();
	const VoiceDebug = AudioManager.GetVoiceQueueDebug();
	const Subtitle = Timeline.GetUniform( Time, 'Subtitle' );
	Hud.MusicLabel.SetValue( MusicDebug );
	Hud.VoiceLabel.SetValue( VoiceDebug );
	Hud.SubtitleLabel.SetValue( Subtitle );

	const DecimalPlaces = 2;
	const Stats_Temp = Timeline.GetUniform( Time, 'Stats_Temp' ).toFixed(DecimalPlaces);
	const Stats_Co2 = Timeline.GetUniform( Time, 'Stats_Co2' ).toFixed(DecimalPlaces);
	const Stats_Oxygen = Timeline.GetUniform( Time, 'Stats_Oxygen' ).toFixed(DecimalPlaces);
	const Stats_Ph = Timeline.GetUniform( Time, 'Stats_Ph' ).toFixed(DecimalPlaces);
	Hud.Stats_Temp.SetValue( Stats_Temp );
	Hud.Stats_Co2.SetValue( Stats_Co2 );
	Hud.Stats_Oxygen.SetValue( Stats_Oxygen );
	Hud.Stats_Ph.SetValue( Stats_Ph );
	
	UpdateSceneVisibility(Time);
}

//	set the actor visibility for this frame
//	setup new animal actors where neccessary
function UpdateSceneVisibility(Time)
{
	const CullingCamera = GetTimelineCamera();
	const Rect = Window.GetScreenRect();
	const Viewport = [0,0,Rect[2],Rect[3]];
	const IsVisible = GetCameraActorCullingFilter( CullingCamera, Viewport );
	let VisibleActorCount = 0;
	const UpdateActorVisibility = function(Actor)
	{
		const WasVisible = Actor.IsVisible || false;
		Actor.IsVisible = IsVisible(Actor);
		if ( !WasVisible && Actor.IsVisible )
		{
			Pop.Debug("Actor " + Actor.Name + " now visible");
		}
		else if ( WasVisible && !Actor.IsVisible )
		{
			Pop.Debug("Actor " + Actor.Name + " now hidden");
		}
		if ( Actor.IsVisible )
			VisibleActorCount++;
	}
	const Actors = GetActorScene( Time, function(){return true;} );
	Actors.forEach( UpdateActorVisibility );
	
	Hud.Debug_VisibleActors.SetValue("Visible Actors: " + VisibleActorCount + "/" + Actors.length );
}

function Render(RenderTarget)
{
	//	gr: don't need to do this here now? let state machine run independently?
	const DurationSecs = 1 / 60;
	Update( DurationSecs );
	
	const Time = Params.TimelineYear;

	const RenderCamera = GetRenderCamera();
	const CullingCamera = Params.DebugCullTimelineCamera ? GetTimelineCamera() : RenderCamera;
	const Viewport = RenderTarget.GetRenderTargetRect();
	//const IsActorVisible = GetCameraActorCullingFilter( CullingCamera, Viewport );
	//const IsActorVisible = GetCameraActorCullingFilter( CullingCamera, Viewport );
	const IsActorVisible = function(Actor)
	{
		if ( Actor.IsVisible === undefined )
			return true;
		return Actor.IsVisible === true;
	}

	//	grab scene first, we're only going to update physics on visible items
	//	todo: just do them all?
	const Scene = GetRenderScene( Time, IsActorVisible );

	const UpdateActorPhysics = function(Actor)
	{
		//	only update actors visible
		//	gr: maybe do this with the actors in scene from GetRenderScene?
		if ( !IsActorVisible(Actor) )
			return;
		const UpdatePhysicsUniforms = function(Shader)
		{
			Shader.SetUniform('NoiseScale', Params.PhysicsDebrisNoiseScale );
			Shader.SetUniform('Damping', Params.PhysicsDebrisDamping );
		}
		Actor.PhysicsIteration( DurationSecs, AppTime, RenderTarget, UpdatePhysicsUniforms );
	}
	
	//	update physics
	if ( PhysicsEnabled || PhsyicsUpdateCount == 0 )
	{
		Scene.forEach( UpdateActorPhysics );
		PhsyicsUpdateCount++;
	}
	RenderTarget.ClearColour( ...Params.FogColour );
	
	const CameraProjectionTransform = RenderCamera.GetProjectionMatrix(Viewport);
	const WorldToCameraTransform = RenderCamera.GetWorldToCameraMatrix();
	const CameraToWorldTransform = Math.MatrixInverse4x4(WorldToCameraTransform);
	
	let FogWorldPos = RenderCamera.Position;
	
	
	let RenderSceneActor = function(Actor,ActorIndex)
	{
		const SetGlobalUniforms = function(Shader)
		{
			Shader.SetUniform('WorldToCameraTransform', WorldToCameraTransform );
			Shader.SetUniform('CameraToWorldTransform', CameraToWorldTransform );
			Shader.SetUniform('CameraProjectionTransform', CameraProjectionTransform );
			Shader.SetUniform('Fog_MinDistance',Params.FogMinDistance);
			Shader.SetUniform('Fog_MaxDistance',Params.FogMaxDistance);
			Shader.SetUniform('Fog_Colour',Params.FogColour);
			Shader.SetUniform('Fog_WorldPosition', FogWorldPos );
			Shader.SetUniform('Light_Colour', Params.LightColour );
			Shader.SetUniform('Light_MinPower', 0.1 );
			Shader.SetUniform('Light_MaxPower', 1.0 );
		
			Timeline.EnumUniforms( Time, Shader.SetUniform.bind(Shader) );
		
			//	actor specific
			let SetUniform = function(Key)
			{
				let Value = Actor.Uniforms[Key];
				Shader.SetUniform( Key, Value );
			}
			Object.keys( Actor.Uniforms ).forEach( SetUniform );
		}
		
		try
		{
			Actor.Render( RenderTarget, ActorIndex, SetGlobalUniforms, Time );
		}
		catch(e)
		{
			Pop.Debug("Error rendering actor", Actor.Name,e);
		}
	}
	Scene.forEach( RenderSceneActor );
	
	Hud.Debug_RenderedActors.SetValue("Rendered Actors: " + Scene.length);
	RenderFrameCounter.Add();

	const Stats = "Batches: " + Pop.Opengl.BatchesDrawn + " Triangles: " + Pop.Opengl.TrianglesDrawn;
	Hud.Debug_RenderStats.SetValue(Stats);
	Pop.Opengl.BatchesDrawn = 0;
	Pop.Opengl.TrianglesDrawn = 0;
	
}


function OnSwitchedToDebugCamera()
{
	//	erk, not grabbing from single place
	let Year = Params.TimelineYear;
	
	//	snap debug camera to run from current viewing position
	let TimelineCamera = GetTimelineCamera();
	DebugCamera.Position = TimelineCamera.Position.slice();
	DebugCamera.LookAt = TimelineCamera.LookAt.slice();
}

function SwitchToDebugCamera()
{
	if ( Params.UseDebugCamera )
		return;
	
	if ( !Params.AutoGrabDebugCamera )
		return;
	
	Params.UseDebugCamera = true;
	ParamsWindow.OnParamChanged('UseDebugCamera');
}


const CameraScene = LoadCameraScene('CameraSpline.dae.json');

const Timeline = LoadTimeline('Timeline.json');



//	now in bootup
//const Window = new Pop.Opengl.Window("Tarqunder the sea");
Window.OnRender = Render;

Window.OnMouseDown = function(x,y,Button)
{
	if ( Button == 0 )
	{
		QueueSceneClick( x, y );
	}

	Window.OnMouseMove( x, y, Button, true );
}

Window.OnMouseMove = function(x,y,Button,FirstClick=false)
{
	UpdateMouseMove( x, y );

	if ( Button == 0 )
	{
		x *= Params.ScrollFlySpeed;
		y *= Params.ScrollFlySpeed;
		SwitchToDebugCamera();
		DebugCamera.OnCameraPanLocal( x, 0, -y, FirstClick );
	}
	if ( Button == 2 )
	{
		x *= Params.ScrollFlySpeed;
		y *= Params.ScrollFlySpeed;
		SwitchToDebugCamera();
		DebugCamera.OnCameraPanLocal( x, y, 0, FirstClick );
	}
	if ( Button == 1 )
	{
		SwitchToDebugCamera();
		DebugCamera.OnCameraOrbit( x, y, 0, FirstClick );
	}
}

Window.OnMouseScroll = function(x,y,Button,Delta)
{
	let Fly = Delta[1] * 10;
	Fly *= Params.ScrollFlySpeed;
	
	SwitchToDebugCamera();
	DebugCamera.OnCameraPanLocal( 0, 0, 0, true );
	DebugCamera.OnCameraPanLocal( 0, 0, Fly, false );
}

