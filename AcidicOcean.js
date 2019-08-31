Pop.Include('PopEngineCommon/PopMath.js');
Pop.Include('PopEngineCommon/PopPly.js');
Pop.Include('PopEngineCommon/PopObj.js');
Pop.Include('PopEngineCommon/PopCollada.js');
Pop.Include('PopEngineCommon/PopCinema4d.js');
Pop.Include('PopEngineCommon/PopTexture.js');
Pop.Include('PopEngineCommon/PopCamera.js');
Pop.Include('PopEngineCommon/ParamsWindow.js');

//Pop.Include('AssetManager.js');
Pop.Include('AudioManager.js');
Pop.Include('Timeline.js');

const ParticleColorShader = Pop.LoadFileAsString('ParticleColour.frag.glsl');
const GeoVertShader = Pop.LoadFileAsString('Geo.vert.glsl');
const ColourFragShader = Pop.LoadFileAsString('Colour.frag.glsl');
const EdgeFragShader = Pop.LoadFileAsString('Edge.frag.glsl');

//	temp turning off and just having dummy actors
const LoadWaterAsInstances = false;



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
const ShellColoursHex = [0xF2BF5E,0xF28705,0xBF5B04,0x730c02,0xc2ae8f,0x9A7F5F,0xbfb39b,0x5B3920,0x755E47,0x7F6854,0x8B7361,0xBF612A,0xD99873,0x591902,0xA62103];
const ShellColours = UnrollHexToRgb(ShellColoursHex);
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

let ShellMeta = {};
ShellMeta.Filename = 'Models/shell_v001.ply';
ShellMeta.Position = [0,0,-2];
ShellMeta.Scale = 0.9;
ShellMeta.TriangleScale = 0.03;
ShellMeta.Colours = ShellColours;
ShellMeta.VertexSkip = 0;

let DebrisMeta = {};
DebrisMeta.Filename = '.random';
DebrisMeta.Position = [0,-17,0];
DebrisMeta.Scale = 30;
DebrisMeta.TriangleScale = 0.052015;	//	0.0398
DebrisMeta.Colours = DebrisColours;
DebrisMeta.VertexSkip = 0;


let OceanFilenames = [];
for ( let i=1;	i<=96;	i++ )
	OceanFilenames.push('Ocean/ocean_pts.' + (''+i).padStart(4,'0') + '.ply');

let OceanMeta = {};
OceanMeta.Filename = OceanFilenames;
OceanMeta.Position = [0,0,0];
OceanMeta.Scale = 1.0;
OceanMeta.TriangleScale = 0.0148;
OceanMeta.Colours = OceanColours;

//let Actor_Shell = new TPhysicsActor( ShellMeta );
var Actor_Shell = null;
var Actor_Ocean = new TAnimatedActor( OceanMeta );
var Actor_Debris = new TPhysicsActor( DebrisMeta );

var AppTime = null;
var Hud = {};
var AudioManager = new TAudioManager( GetAudioGetCrossFadeDuration );


var SelectedActors = [];

Math.GetIntersectionRayBox3 = function(RayStart,RayDirection,BoxPosition,BoxMin,BoxMax)
{
	let tmin = null;
	let tmax = null;
	
	for ( let dim=0;	dim<3;	dim++ )
	{
		let AxisDir = RayDirection[dim];
		if ( AxisDir == 0 )
			continue;
		let tx1 = ( BoxPosition[dim] + BoxMin[dim] - RayStart[dim] ) / AxisDir;
		let tx2 = ( BoxPosition[dim] + BoxMax[dim] - RayStart[dim] ) / AxisDir;
		
		let min = Math.min( tx1, tx2 );
		let max = Math.max( tx1, tx2 );
		tmin = Math.max( tmin, min ) || min;
		tmax = Math.min( tmax, max ) || max;
	}
	
	//	invalid input ray (dir = 000)
	if ( tmin === null )
	{
		Pop.Debug("GetIntersectionRayBox3 invalid ray", RayStart, RayDirection );
		return false;
	}
	
	if ( tmin < 0 )
	{
		//	ray inside box... maybe change this return so its the exit intersection?
		//return RayStart;
	}
	
	if ( tmax < tmin )
		return false;
	
	let Intersection = Math.Multiply3( RayDirection, [tmin,tmin,tmin] );
	Intersection = Math.Add3( RayStart, Intersection );
	
	return Intersection;
}

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

function GetIntersectingActors(Ray,Scene)
{
	const Intersections = [];
	
	function TestIntersecting(Actor)
	{
		if ( !IsActorSelectable(Actor) )
			return;
		
		const BoundingBox = Actor.GetBoundingBox();
		const LocalTransform = Actor.GetLocalToWorldTransform();
		const WorldPos = Math.GetMatrixTranslation( LocalTransform );
		const IntersectionPos = Math.GetIntersectionRayBox3( Ray.Start, Ray.Direction, WorldPos, BoundingBox.Min, BoundingBox.Max );
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


let LastMouseRay = null;
let LastMouseRayUv = null;

function GetMouseRay(uv)
{
	let ScreenRect = Window.GetScreenRect();
	let Aspect = ScreenRect[2] / ScreenRect[3];
	let x = Math.lerp( -Aspect, Aspect, uv[0] );
	let y = Math.lerp( 1, -1, uv[1] );
	const ViewRect = [-1,-1,1,1];
	let Time = Params.TimelineYear;
	//	get ray
	const Camera = Params.MouseRayOnTimelineCamera ? GetTimelineCamera( Time ) : GetRenderCamera( Time );
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
	Ray.Start = Math.GetMatrixTranslation( StartMatrix, Params.TestRayDivW );
	Ray.End = Math.GetMatrixTranslation( EndMatrix, Params.TestRayDivW );
	Ray.Direction = Math.Normalise3( Math.Subtract3( Ray.End, Ray.Start ) );
	
	return Ray;
}

function UpdateMouseMove(CameraScreenUv)
{
	//Pop.Debug(CameraScreenUv);
	let Time = Params.TimelineYear;
	LastMouseRayUv = CameraScreenUv;
	
	const Ray = GetMouseRay( CameraScreenUv );
	
	LastMouseRay = Ray;
	
	//	find actor
	let Scene = GetActorScene( Time );
	SelectedActors = GetIntersectingActors( Ray, Scene );
	Pop.Debug("SelectedActors x" + SelectedActors.length);
}




const TimelineMinYear = 1820;
const TimelineMinInteractiveYear = 1860;
const TimelineMaxYear = 2100;
const TimelineMaxInteractiveYear = 2100;

Params.TimelineYear = TimelineMinYear;
Params.MouseRayOnTimelineCamera = false;
Params.TestRaySize = 0.39;
Params.DrawTestRay = false;
Params.TestRayDistance = 0.82;
Params.TestRayDivW = true;
Params.ExperiencePlaying = true;
Params.UseDebugCamera = false;
Params.ExperienceDurationSecs = 240;
Params.EnableMusic = true;
Params.DebugCameraPositionCount = 0;
Params.DebugCameraPositionScale = 0.15;
Params.FogMinDistance = 11.37;
Params.FogMaxDistance = 24.45;
Params.FogColour = FogColour;
Params.LightColour = LightColour;
Params.Ocean_TriangleScale = OceanMeta.TriangleScale;
Params.Debris_TriangleScale = DebrisMeta.TriangleScale;
Params.DebugPhysicsTextures = false;
Params.BillboardTriangles = true;
Params.ShowClippedParticle = false;
Params.CameraNearDistance = 0.1;
Params.CameraFarDistance = 50;
Params.CameraFaceForward = true;
Params.AudioCrossFadeDurationSecs = 2;
Params.OceanAnimationFrameRate = 60;
Params.DrawBoundingBoxes = false;
Params.DrawBoundingBoxesFilled = false;
Params.ActorPlaceholdersScale = 0.1;
Params.ScrollFlySpeed = 100;

let OnParamsChanged = function(Params,ChangedParamName)
{
	if ( Actor_Ocean )
		Actor_Ocean.Meta.TriangleScale = Params.Ocean_TriangleScale;
	
	if ( Actor_Debris )
		Actor_Debris.Meta.TriangleScale = Params.Debris_TriangleScale;
	
	if ( ChangedParamName == 'UseDebugCamera' && Params.UseDebugCamera )
		OnSwitchedToDebugCamera();
}


const ParamsWindowRect = [800,20,350,200];
let ParamsWindow = new CreateParamsWindow(Params,OnParamsChanged,ParamsWindowRect);
ParamsWindow.AddParam('TimelineYear',TimelineMinYear,TimelineMaxYear);	//	can no longer clean as we move timeline in float
ParamsWindow.AddParam('MouseRayOnTimelineCamera');
ParamsWindow.AddParam('TestRayDistance',-1,1);
ParamsWindow.AddParam('TestRaySize',0,10);
ParamsWindow.AddParam('DrawTestRay');
ParamsWindow.AddParam('TestRayDivW');
ParamsWindow.AddParam('ExperiencePlaying');
ParamsWindow.AddParam('UseDebugCamera');
ParamsWindow.AddParam('EnableMusic');
ParamsWindow.AddParam('ExperienceDurationSecs',30,600);
ParamsWindow.AddParam('DrawBoundingBoxes');
ParamsWindow.AddParam('DrawBoundingBoxesFilled');
ParamsWindow.AddParam('ActorPlaceholdersScale',0,1);
ParamsWindow.AddParam('DebugCameraPositionCount',0,200,Math.floor);
ParamsWindow.AddParam('DebugCameraPositionScale',0,1);
ParamsWindow.AddParam('FogColour','Colour');
ParamsWindow.AddParam('LightColour','Colour');
ParamsWindow.AddParam('Ocean_TriangleScale',0,1.2);
ParamsWindow.AddParam('Debris_TriangleScale',0,1.2);
ParamsWindow.AddParam('FogMinDistance',0,30);
ParamsWindow.AddParam('FogMaxDistance',0,100);
ParamsWindow.AddParam('EnablePhysicsIteration');
ParamsWindow.AddParam('DebugPhysicsTextures');
ParamsWindow.AddParam('BillboardTriangles');
ParamsWindow.AddParam('ShowClippedParticle');
ParamsWindow.AddParam('CameraNearDistance', 0.01, 10);
ParamsWindow.AddParam('CameraFarDistance', 1, 100);
ParamsWindow.AddParam('CameraFaceForward');
ParamsWindow.AddParam('AudioCrossFadeDurationSecs',0,10);
ParamsWindow.AddParam('OceanAnimationFrameRate',1,60);
ParamsWindow.AddParam('ScrollFlySpeed',1,300);


let SelectedActor = null;



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


function LoadCameraScene(Filename)
{
	let Scene = [];
	
	let OnActor = function(ActorNode)
	{
		if ( ActorNode.Name.startsWith('Water_') && Actor_Debris )
		{
			if ( LoadWaterAsInstances )
			{
				//	add an instance
				if ( !Actor_Debris.Instances )
					Actor_Debris.Instances = [];
			
				Actor_Debris.Instances.push( ActorNode.Position );
			}
			//	temp until we do instances
			Actor_Debris.Position = ActorNode.Position;
			//return;
		}
		
		
		if ( ActorNode.Name.startsWith('Ocean_surface_0') && Actor_Ocean )
		{
			if ( LoadWaterAsInstances )
			{
				//	add an instance
				if ( !Actor_Ocean.Instances )
					Actor_Ocean.Instances = [];

				Actor_Ocean.Instances.push( ActorNode.Position );
			}
			//	temp until we do instances
			Actor_Ocean.Position = ActorNode.Position;
			//return;
		}
		
		//Pop.Debug("Loading actor", ActorNode.Name, ActorNode );
		let Actor = new TActor();
		Actor.Name = ActorNode.Name;
		Actor.Geometry = 'Cube';
		
		let LocalScale = Math.CreateScaleMatrix( Params.ActorPlaceholdersScale );
		let WorldPos = Math.CreateTranslationMatrix( ...ActorNode.Position );
		Actor.LocalToWorldTransform = Math.MatrixMultiply4x4( WorldPos, LocalScale );
		
		Actor.VertShader = GeoVertShader;
		Actor.FragShader = ColourFragShader;
		Actor.BoundingBox = ActorNode.BoundingBox;
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

function GetTimelineCamera(Time)
{
	//	apply timeline camera pos temporarily and then remove again
	/*
	 Camera.Position = Math.Add3( Camera.Position, TimelineCameraPos );
	 Camera.LookAt = Math.Add3( Camera.LookAt, TimelineCameraPos );
	 const WorldToCameraTransform = Camera.GetWorldToCameraMatrix();
	 Camera.Position = Math.Subtract3( Camera.Position, TimelineCameraPos );
	 Camera.LookAt = Math.Subtract3( Camera.LookAt, TimelineCameraPos );
	 */
	
	let Camera = new Pop.Camera();
	Camera.Position = GetTimelineCameraPosition(Time);
	if ( Params.CameraFaceForward )
	{
		Camera.LookAt = Camera.Position.slice();
		Camera.LookAt[2] -= 1.0;
	}
	else
	{
		Camera.LookAt = GetTimelineCameraPosition(Time+0.01);
	}
	
	Camera.NearDistance = Params.CameraNearDistance;
	Camera.FarDistance = Params.CameraFarDistance;
	return Camera;
}

function GetRenderCamera(Time)
{
	if ( Params.UseDebugCamera )
		return DebugCamera;
	
	return GetTimelineCamera(Time);
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



function GetActorScene(Time)
{
	let Scene = [];
	

	let PushPositionBufferActor = function(Actor)
	{
		if ( Actor.Instances )
		{
			//	turn below into a proper TActor and then draw multiple cases with different transforms
		}
		
		Actor.Render = function(RenderTarget, ActorIndex, SetGlobalUniforms, Time)
		{
			RenderTriangleBufferActor( RenderTarget, this, ActorIndex, SetGlobalUniforms, Time );
		}
		
		const PositionsTexture = Actor.GetPositionsTexture();
		Actor.Uniforms = [];
		Actor.Uniforms['WorldPositions'] = PositionsTexture;
		Actor.Uniforms['WorldPositionsWidth'] = PositionsTexture.GetWidth();
		Actor.Uniforms['WorldPositionsHeight'] = PositionsTexture.GetHeight();
		Actor.Uniforms['TriangleScale']= Actor.Meta.TriangleScale;
		Actor.Uniforms['Colours']= Actor.Colours;
		Actor.Uniforms['ColourCount']= Actor.Colours.length/3;
		//let a = new TActor( )
		Scene.push( Actor );
	}

	if ( Actor_Debris )	PushPositionBufferActor( Actor_Debris );
	
	if ( Actor_Ocean )	PushPositionBufferActor( Actor_Ocean );
	
	CameraScene.forEach( a => Scene.push(a) );
	
	return Scene;
}


//	get scene graph
function GetRenderScene(Time)
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
		let Camera = GetTimelineCamera(Time);
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
	
	let PushPositionBufferActor = function(Actor)
	{
		if ( Actor.Instances )
		{
			//	turn below into a proper TActor and then draw multiple cases with different transforms
		}
		
		Actor.Render = function(RenderTarget, ActorIndex, SetGlobalUniforms, Time)
		{
			RenderTriangleBufferActor( RenderTarget, this, ActorIndex, SetGlobalUniforms, Time );
		}
		
		const PositionsTexture = Actor.GetPositionsTexture();
		Actor.Uniforms = [];
		Actor.Uniforms['WorldPositions'] = PositionsTexture;
		Actor.Uniforms['WorldPositionsWidth'] = PositionsTexture.GetWidth();
		Actor.Uniforms['WorldPositionsHeight'] = PositionsTexture.GetHeight();
		Actor.Uniforms['TriangleScale']= Actor.Meta.TriangleScale;
		Actor.Uniforms['Colours']= Actor.Colours;
		Actor.Uniforms['ColourCount']= Actor.Colours.length/3;
		//let a = new TActor( )
		PushActorBoundingBox( Actor );
		Scene.push( Actor );
	}
	/*
	let ShellAlpha = Timeline.GetUniform(Time,'ShellAlpha');
	if ( ShellAlpha > 0.5 )
		PushPositionBufferActor( Actor_Shell );
	*/
	
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
	
	
	const ActorScene = GetActorScene(Time);
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
		Pop.Debug("Selected",Intersection.Actor.Name);
		let Pos = Math.CreateTranslationMatrix( ...Intersection.Position );
		let TestSize = Params.TestRaySize / 2;
		let Min = [-TestSize,-TestSize,-TestSize];
		let Max = [TestSize,TestSize,TestSize];
		PushActorBox( Pos, Min, Max, true );
	}
	SelectedActors.forEach( DrawIntersection );
	
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
}


//	todo: proper app loop, currently triggered from render
function Update(FrameDurationSecs)
{
	if ( AppTime === null )
		Init();
	
	AppTime += FrameDurationSecs;

	//	auto increment year
	if ( Params.ExperiencePlaying )
	{
		const ExpYears = TimelineMaxYear - TimelineMinYear;
		const YearsPerSec = ExpYears / Params.ExperienceDurationSecs;
		const YearsPerFrame = FrameDurationSecs * YearsPerSec;
		Params.TimelineYear += YearsPerFrame;
		ParamsWindow.OnParamChanged('TimelineYear');
	}

	let Time = Params.TimelineYear;

	
	//	update audio
	const CurrentMusic = Timeline.GetUniform( Time, 'Music' );
	AudioManager.SetMusic( Params.EnableMusic ? CurrentMusic : null );
	const CurrentVoice = Timeline.GetUniform( Time, 'VoiceAudio' );
	AudioManager.PlayVoice( CurrentVoice );
	AudioManager.Update( FrameDurationSecs );

	//	update some stuff from timeline
	Params.FogColour = Timeline.GetUniform( Time, 'FogColour' );
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
}



function Render(RenderTarget)
{
	const DurationSecs = 1 / 60;
	Update( DurationSecs );
	
	//let Time = Math.Range( TimelineMinYear, TimelineMaxYear, Params.TimelineYear );
	let Time = Params.TimelineYear;
	
	//	update physics
	if ( Actor_Shell )
		Actor_Shell.PhysicsIteration( DurationSecs, AppTime, RenderTarget );
	if ( Actor_Ocean )
		Actor_Ocean.PhysicsIteration( DurationSecs, AppTime, RenderTarget );
	if ( Actor_Debris )
		Actor_Debris.PhysicsIteration( DurationSecs, AppTime, RenderTarget );

	RenderTarget.ClearColour( ...Params.FogColour );
	
	const RenderCamera = GetRenderCamera( Time );
	const Viewport = RenderTarget.GetRenderTargetRect();
	const CameraProjectionTransform = RenderCamera.GetProjectionMatrix(Viewport);
	const WorldToCameraTransform = RenderCamera.GetWorldToCameraMatrix();
	const CameraToWorldTransform = Math.MatrixInverse4x4(WorldToCameraTransform);

	const Scene = GetRenderScene(Time);
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
		
		Actor.Render( RenderTarget, ActorIndex, SetGlobalUniforms, Time );
	}
	Scene.forEach( RenderSceneActor );
	
}


function OnSwitchedToDebugCamera()
{
	//	erk, not grabbing from single place
	let Year = Params.TimelineYear;
	
	//	snap debug camera to run from current viewing position
	let TimelineCamera = GetTimelineCamera(Year);
	DebugCamera.Position = TimelineCamera.Position.slice();
	DebugCamera.LookAt = TimelineCamera.LookAt.slice();
}

function SwitchToDebugCamera()
{
	if ( Params.UseDebugCamera )
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
	Window.OnMouseMove( x, y, Button, true );
}

Window.OnMouseMove = function(x,y,Button,FirstClick=false)
{
	let Rect = Window.GetScreenRect();
	let u = x / Rect[2];
	let v = y / Rect[3];
	UpdateMouseMove( [u,v] );

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

