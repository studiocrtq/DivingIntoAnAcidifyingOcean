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
Pop.Include('ParticleActor.js');
//	already included
//Pop.Include('Timeline.js');
//Pop.Include('Animals.js');

const EnableVoiceOver = Pop.GetExeArguments().includes('EnableVoiceOver');
const BoldMode = Pop.GetExeArguments().includes('Bold');
const AnimalTest = Pop.GetExeArguments().includes('AnimalTest');

const ExplosionSoundFilename = 'Audio/AcidicOcean_FX_Explosion.mp3';
const AnimalSelectedSoundFilename = 'Audio/AcidicOcean_FX_MouseClick.mp3';
const AnimalDissolveSoundFilename = 'Audio/AcidicOcean_FX_ShellDissolution.mp3';

//	for debugging opengl stuff
const EnableColourTextureUpdate = false;

//	temp turning off and just having dummy actors
const PhysicsEnabled = !Pop.GetExeArguments().includes('PhysicsDisabled');
var PhsyicsUpdateCount = 0;	//	gotta do one

var Debug_HighlightActors = [];

const ShowDefaultActors = Pop.GetExeArguments().includes('ShowDefaultActors');
const IgnoreActorPrefixs = ['Camera_Spline'];
//const IgnoreActorPrefixs = ['Camera_Spline',OceanActorPrefix,DebrisActorPrefix];	//	nocrash?
//const IgnoreActorPrefixs = ['Camera_Spline',DebrisActorPrefix];	//	crash
//const IgnoreActorPrefixs = ['Camera_Spline',OceanActorPrefix];	//	crash



//	colours from colorbrewer2.org
const FogColour = Pop.Colour.HexToRgbf(0x000000);
const LightColour = [0.86,0.95,0.94];

var Noise_TurbulenceTexture = new Pop.Image( [512,512], 'Float4' );
var OceanColourTexture = new Pop.Image();
var DebrisColourTexture = new Pop.Image();

let DebugCamera = new Pop.Camera();
DebugCamera.Position = [ 0,0,0 ];
DebugCamera.LookAt = [ 0,0,-1 ];
DebugCamera.FarDistance = 400;	//	try not to clip anythig in debug mode



function IsAutoClearTextureActor(Actor)
{
	if ( Actor.Name.startsWith(OceanActorPrefix) )
	{
		return false;
	}
	
	return true;
}


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



function GetMusicVolume()	{	return Params.MusicVolume;	}
function GetMusic2Volume()	{	return Params.Music2Volume;	}
function GetVoiceVolume()	{	return Params.VoiceVolume;	}
function GetSoundVolume()	{	return Params.SoundVolume;	}

var AppTime = null;
var Hud = {};
var AudioManager = new TAudioManager( GetAudioGetCrossFadeDuration, GetMusicVolume, GetMusic2Volume, GetVoiceVolume, GetSoundVolume );

var LastMouseRay = null;	//	gr: this isn't getting updated any more
var LastMouseRayUv = null;
var LastMouseClicks = [];	//	array of queued uvs

var RenderFrameCounter = new Pop.FrameCounter();



function IsActorSelectable(Actor)
{
	if ( !Actor.Name )
		return false;
	
	const SelectableNames = AnimalActorPrefixs;
	const Match = SelectableNames.some( MatchName => Actor.Name.startsWith(MatchName) );
	if ( !Match )
		return false;
	
	if ( Actor.AnimalHasBeenExploded )
		return false;
	
	return true;
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
	const Scene = GetActorScene( FilterActor );
	const SelectedActors = GetIntersectingActors( Ray, Scene );
	
	return SelectedActors;
}



const TimelineMinYear = 1800;
const TimelineBigBangYear = 1823;
const TimelineMinInteractiveYear = 1860;
const TimelineMaxYear = 2160;
const TimelineMaxInteractiveYear = 2100;
const TimelineSolutionYear = 2146;

const BigBangDuration = 10;

Params.TimelineYear = TimelineMinYear;
Params.YearsPerSecond = 1;
Params.CustomYearsPerSecond = false;
Params.ShowAnimal_ExplodeSecs = 3;
Params.ShowAnimal_Duration = 40;
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
Params.DrawTestRay = false;
Params.TestRayDistance = 0.82;
Params.ExperiencePlaying = true;
Params.AutoGrabDebugCamera = false;
Params.UseDebugCamera = false;
Params.EnableMusic = true;
Params.MusicVolume = 1;
Params.Music2Volume = 1;
Params.VoiceVolume = 1;
Params.SoundVolume = 1;
Params.DebugCameraPositionCount = 0;
Params.DebugCameraPositionScale = 0.15;
Params.FogMinDistance = 8.0;
Params.FogMaxDistance = BoldMode ? 999 : 20.0;
Params.FogHighlightMinDistance = 0.8;
Params.FogHighlightMaxDistance = 2.7;
Params.FogColour = FogColour;
Params.FogParamsLerpSpeed = 0.1;
Params.FogTargetLerpSpeed = 0.2;
Params.LightColour = LightColour;
Params.DebugPhysicsTextures = false;
Params.DebugNoiseTextures = IsDebugEnabled();
Params.BillboardTriangles = true;
Params.ShowClippedParticle = false;
Params.CameraNearDistance = 0.1;
Params.CameraFarDistance = 24;	//	under 20 and keeps clipping too easily
Params.AudioCrossFadeDurationSecs = 2;
Params.OceanAnimationFrameRate = 25;
Params.DrawBoundingBoxes = false;
Params.DrawBoundingBoxesFilled = false;
Params.DrawHighlightedActors = false;

Params.BigBang_Damping = 0.01;
Params.BigBang_NoiseScale = 0.01;
Params.BigBang_TinyNoiseScale = 0.5;

Params.Animal_TriangleScale = 0.01;
Params.Animal_PhysicsDamping = 0.12;
Params.Animal_PhysicsNoiseScale = 16.0;
Params.NastyAnimal_PhysicsNoiseScale = 0.45;
Params.NastyAnimal_PhysicsSpringScale = 0.65;
Params.NastyAnimal_PhysicsDamping = 0.01;
Params.NastyAnimal_PhysicsExplodeScale = 3.1;

Params.Debris_TriangleScale = BoldMode ? 0.09 : 0.025;
Params.Debris_PhysicsDamping = 0.04;
Params.Debris_PhysicsNoiseScale = 9.9;

Params.CustomiseWaterColours = false;
Params.UpdateColourTextureFrequencySecs = 0.3;
Params.Debris_Colour0 = InvalidColour;
Params.Debris_Colour1 = InvalidColour;
Params.Debris_Colour2 = InvalidColour;
Params.Debris_Colour3 = InvalidColour;
Params.Debris_Colour4 = InvalidColour;
Params.Debris_Colour5 = InvalidColour;
Params.Debris_Colour6 = InvalidColour;
Params.Debris_Colour7 = InvalidColour;
Params.Debris_Colour8 = InvalidColour;
Params.Debris_Colour9 = InvalidColour;
Params.Ocean_TriangleScale = BoldMode ? 0.2 : 0.0148;
Params.Ocean_Colour0 = InvalidColour;
Params.Ocean_Colour1 = InvalidColour;
Params.Ocean_Colour2 = InvalidColour;
Params.Ocean_Colour3 = InvalidColour;
Params.Ocean_Colour4 = InvalidColour;
Params.Ocean_Colour5 = InvalidColour;
Params.Ocean_Colour6 = InvalidColour;
Params.Ocean_Colour7 = InvalidColour;
Params.Ocean_Colour8 = InvalidColour;
Params.Ocean_Colour9 = InvalidColour;

Params.Turbulence_Frequency = 4.0;
Params.Turbulence_Amplitude = 1.0;
Params.Turbulence_Lacunarity = 0.10;
Params.Turbulence_Persistence = 0.20;
Params.Turbulence_TimeScalar = 0.14;

Params.AnimalScale = 1.0;
Params.AnimalFlip = false;

let OnParamsChanged = function(Params,ChangedParamName)
{
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
	ParamsWindow.AddParam('YearsPerSecond',0,10);
	ParamsWindow.AddParam('CustomYearsPerSecond');
	ParamsWindow.AddParam('ExperiencePlaying');
	ParamsWindow.AddParam('UseDebugCamera');
	ParamsWindow.AddParam('MusicVolume',0,1);
	ParamsWindow.AddParam('Music2Volume',0,1);
	ParamsWindow.AddParam('VoiceVolume',0,1);
	ParamsWindow.AddParam('SoundVolume',0,1);
	ParamsWindow.AddParam('ShowAnimal_ExplodeSecs',0,20);
	ParamsWindow.AddParam('ShowAnimal_Duration',0,60);
	ParamsWindow.AddParam('ShowAnimal_CameraOffsetX',-10,10);
	ParamsWindow.AddParam('ShowAnimal_CameraOffsetY',-10,10);
	ParamsWindow.AddParam('ShowAnimal_CameraOffsetZ',-10,10);
	ParamsWindow.AddParam('ShowAnimal_CameraLerpInSpeed',0,1);
	ParamsWindow.AddParam('ShowAnimal_CameraLerpOutSpeed',0,1);
	ParamsWindow.AddParam('DebugNoiseTextures');
	ParamsWindow.AddParam('AnimalBufferLod',0,1);

	ParamsWindow.AddParam('AutoGrabDebugCamera');
	ParamsWindow.AddParam('FogColour','Colour');
	ParamsWindow.AddParam('LightColour','Colour');

	ParamsWindow.AddParam('FogMinDistance',0,50);
	ParamsWindow.AddParam('FogMaxDistance',0,50);
	ParamsWindow.AddParam('FogHighlightMinDistance',0,50);
	ParamsWindow.AddParam('FogHighlightMaxDistance',0,50);
	ParamsWindow.AddParam('FogParamsLerpSpeed',0,1);
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
	ParamsWindow.AddParam('DrawHighlightedActors');
	ParamsWindow.AddParam('EnablePhysicsIteration');
	ParamsWindow.AddParam('DebugPhysicsTextures');
	ParamsWindow.AddParam('BillboardTriangles');
	ParamsWindow.AddParam('ShowClippedParticle');
	ParamsWindow.AddParam('CameraNearDistance', 0.01, 10);
	ParamsWindow.AddParam('CameraFarDistance', 1, 100);
	ParamsWindow.AddParam('ScrollFlySpeed',1,300);
	
	
	ParamsWindow.AddParam('NastyAnimal_PhysicsNoiseScale',0,10);
	ParamsWindow.AddParam('NastyAnimal_PhysicsSpringScale',0,1);
	ParamsWindow.AddParam('NastyAnimal_PhysicsExplodeScale',0,10);
	ParamsWindow.AddParam('NastyAnimal_PhysicsDamping',0,1);

	ParamsWindow.AddParam('BigBang_Damping',0,1);
	ParamsWindow.AddParam('BigBang_NoiseScale',0,5);
	ParamsWindow.AddParam('BigBang_TinyNoiseScale',0,20);

	
	ParamsWindow.AddParam('Debris_TriangleScale',0.001,0.2);
	ParamsWindow.AddParam('Debris_PhysicsDamping',0,1);
	ParamsWindow.AddParam('Debris_PhysicsNoiseScale',0,1);
	ParamsWindow.AddParam('CustomiseWaterColours');
	ParamsWindow.AddParam('UpdateColourTextureFrequencySecs',0,4);
	
	ParamsWindow.AddParam('Debris_Colour0','Colour');
	ParamsWindow.AddParam('Debris_Colour1','Colour');
	ParamsWindow.AddParam('Debris_Colour2','Colour');
	ParamsWindow.AddParam('Debris_Colour3','Colour');
	ParamsWindow.AddParam('Debris_Colour4','Colour');
	ParamsWindow.AddParam('Debris_Colour5','Colour');
	ParamsWindow.AddParam('Debris_Colour6','Colour');
	ParamsWindow.AddParam('Debris_Colour7','Colour');
	ParamsWindow.AddParam('Debris_Colour8','Colour');
	ParamsWindow.AddParam('Debris_Colour9','Colour');
	ParamsWindow.AddParam('Ocean_TriangleScale',0.001,0.2);
	ParamsWindow.AddParam('Ocean_Colour0','Colour');
	ParamsWindow.AddParam('Ocean_Colour1','Colour');
	ParamsWindow.AddParam('Ocean_Colour2','Colour');
	ParamsWindow.AddParam('Ocean_Colour3','Colour');
	ParamsWindow.AddParam('Ocean_Colour4','Colour');
	ParamsWindow.AddParam('Ocean_Colour5','Colour');
	ParamsWindow.AddParam('Ocean_Colour6','Colour');
	ParamsWindow.AddParam('Ocean_Colour7','Colour');
	ParamsWindow.AddParam('Ocean_Colour8','Colour');
	ParamsWindow.AddParam('Ocean_Colour9','Colour');

	
	ParamsWindow.AddParam('Animal_TriangleScale',0.001,0.2);
	ParamsWindow.AddParam('Animal_PhysicsDamping',0,1);
	ParamsWindow.AddParam('Animal_PhysicsNoiseScale',0,20);
	ParamsWindow.AddParam('Turbulence_Frequency',0,4);
	ParamsWindow.AddParam('Turbulence_Amplitude',0,4);
	ParamsWindow.AddParam('Turbulence_Lacunarity',0,4);
	ParamsWindow.AddParam('Turbulence_Persistence',0,4);
	ParamsWindow.AddParam('Turbulence_TimeScalar',0,10);

	ParamsWindow.AddParam('AnimalScale',0,2);
	ParamsWindow.AddParam('AnimalFlip');
	ParamsWindow.AddParam('AnimalDebugParticleColour');
}



function LoadCameraScene(Filename)
{
	let Scene = [];
	
	let OnActor = function(ActorNode)
	{
		if ( IgnoreActorPrefixs.some( MatchName => ActorNode.Name.includes(MatchName) ) )
		{
			Pop.Debug("Ignoring actor node " + ActorNode.Name, ActorNode );
			return;
		}
		
		Pop.Debug("Loading actor", ActorNode.Name, ActorNode );
		let Actor = new TActor();
		Actor.Name = ActorNode.Name;
		
		//	there are some new objects with no bounding boxes or geo,
		//	but they're not ones we want to turn to animals anyway
		let IsAnimalActor = IsActorSelectable(Actor);
		const IsDebrisActor = ActorNode.Name.startsWith(DebrisActorPrefix);
		const IsOceanActor = ActorNode.Name.startsWith(OceanActorPrefix);
		
		
		if ( ShowDefaultActors )
			IsAnimalActor = false;
		
		const IsParticleActor = IsAnimalActor || IsDebrisActor || IsOceanActor;
		
		//if ( !ShowDefaultActors && IsParticleActor )
		if ( IsParticleActor )
		{
			//let LocalScale = ActorNode.Scale;
			let WorldPos = ActorNode.Position;
			Actor.LocalToWorldTransform = Math.CreateTranslationMatrix( ...WorldPos );
			Actor.BoundingBox = ActorNode.BoundingBox;
			
			if ( IsOceanActor )
			{
				SetupAnimalTextureBufferActor.call( Actor, GetOceanMeta().Filename, GetOceanMeta );
			}
			else if ( IsDebrisActor )
			{
				SetupAnimalTextureBufferActor.call( Actor, GetDebrisMeta().Filename, GetDebrisMeta );
			}
			else
			{
				const Animal = GetRandomAnimal( ActorNode.Name );
				Actor.Animal = Animal;
				Actor.Name += " " + Animal.Name;
				let GetMeta = GetAnimalMeta;
				if ( ActorNode.Name.startsWith( NastyAnimalPrefix ) )
					GetMeta = GetNastyAnimalMeta;
				if ( ActorNode.Name.startsWith( BigBangAnimalPrefix ) )
					GetMeta = GetBigBangAnimalMeta;
				SetupAnimalTextureBufferActor.call( Actor, Animal.Model, GetMeta );
			}
		}
		else
		{
			Pop.Debug("Making default actor",ActorNode.Name);
			
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
				
				BoundsScale = Math.Multiply3( BoundsScale, [0.5,0.5,0.5] );
				
				LocalScale = BoundsScale;
				WorldPos = Math.Add3( WorldPos, BoundsCenter );
				ActorNode.BoundingBox.Max = [1,1,1];
				ActorNode.BoundingBox.Min = [0,0,0];
				Pop.Debug( ActorNode.Name, "BoundsScale", BoundsScale, "ActorNode.Scale", ActorNode.Scale );
			}
			
			let LocalScaleMtx = Math.CreateScaleMatrix( ...LocalScale );
			let WorldPosMtx = Math.CreateTranslationMatrix( ...WorldPos );
			
			Actor.LocalToWorldTransform = Math.MatrixMultiply4x4( WorldPosMtx, LocalScaleMtx );
			
			Actor.RenderShader = GeoColourShader;
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





//	filter for culling
function GetActorScene(Filter)
{
	let Scene = [];
	Filter = Filter || function(Actor)	{	return true;	};

	let PushCameraSceneActor = function(Actor)
	{
		if ( !Filter(Actor) )
			return;
		
		Scene.push(Actor)
	}
	
	CameraScene.forEach( PushCameraSceneActor );
	
	return Scene;
}


//	get scene graph
function GetRenderScene(GetActorScene,Time,VisibleFilter)
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
		BoundsActor.RenderShader = GeoEdgeShader;
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
		Actor.RenderShader = GeoEdgeShader;
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
		Actor.RenderShader = GeoColourShader;
		Scene.push( Actor );
	}
	
	const ActorScene = GetActorScene( VisibleFilter );
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
	if ( Params.DrawHighlightedActors )
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
	
	
	CameraScene = LoadCameraScene('CameraSpline.dae.json');
	Timeline = LoadTimeline('Timeline.json');
	
	//	init very first camera pos
	Acid.CameraPosition = GetTimelineCameraPosition( Params.TimelineYear );

	Hud.MusicLabel = new Pop.Hud.Label('AudioMusicLabel');
	Hud.Music2Label = new Pop.Hud.Label('AudioMusic2Label');
	Hud.VoiceLabel = new Pop.Hud.Label('AudioVoiceLabel');
	Hud.SubtitleLabel = new Pop.Hud.Label('SubtitleLabel');
	Hud.Timeline = new Pop.Hud.Label('TimelineContainer');
	Hud.YearLabel = new Pop.Hud.Label('YearLabel');
	Hud.YearSlider = new Pop.Hud.Slider('YearSlider');
	Hud.YearSlider.SetMinMax( TimelineMinInteractiveYear, TimelineMaxInteractiveYear );
	Hud.YearSlider.OnChanged = function(NewValue)
	{
		Pop.Debug("Slider changed",NewValue);
		Acid.UserSetYear = NewValue;
	}
	
	Hud.Stats = new Pop.Hud.Label('Stats');
	Hud.Stats_Temp = new Pop.Hud.Label('Stats_Temp_Label');
	Hud.Stats_Co2 = new Pop.Hud.Label('Stats_Co2_Label');
	Hud.Stats_Oxygen = new Pop.Hud.Label('Stats_Oxygen_Label');
	Hud.Stats_Ph = new Pop.Hud.Label('Stats_Ph_Label');
		
	Hud.Animal_Card = new Pop.Hud.Label('AnimalCard');
	Hud.Animal_Title = new Pop.Hud.Label('AnimalCard_Title');
	Hud.Animal_Description = new Pop.Hud.Label('AnimalCard_Description');
	Hud.Animal_ContinueButton = new Pop.Hud.Button('Continue');

	if ( IsDebugEnabled() )
	{
		let DebugHud = new Pop.Hud.Label('Debug');
		DebugHud.SetVisible(true);
	}
	Hud.Debug_State = new Pop.Hud.Label('Debug_State');
	Hud.Debug_VisibleActors = new Pop.Hud.Label('Debug_VisibleActors');
	Hud.Debug_RenderedActors = new Pop.Hud.Label('Debug_RenderedActors');
	Hud.Debug_RenderStats = new Pop.Hud.Label('Debug_RenderStats');
	Hud.Debug_FrameRate = new Pop.Hud.Label('Debug_FrameRate');
	Hud.Debug_TextureHeap = new Pop.Hud.Label('Debug_TextureHeap');
	Hud.Debug_GeometryHeap = new Pop.Hud.Label('Debug_GeometryHeap');

	Hud.Animal_Card.SetVisible(false);
	
	Hud.Hint_ClickAnimal = new Pop.Hud.Label('Hint_ClickAnimal');
	Hud.Hint_DragTimeline = new Pop.Hud.Label('Hint_DragTimeline');

	
	RenderFrameCounter.Report = function(CountPerSec)
	{
		Hud.Debug_FrameRate.SetValue( CountPerSec.toFixed(2) + " fps" );
	}
	
	
	//	setup window (we do it here so we know update has happened first)
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
			SwitchToDebugCamera(true);
			DebugCamera.OnCameraPanLocal( x, y, 0, FirstClick );
		}
		if ( Button == 1 )
		{
			SwitchToDebugCamera(true);
			DebugCamera.OnCameraOrbit( x, y, 0, FirstClick );
		}
	}
	
	Window.OnMouseScroll = function(x,y,Button,Delta)
	{
		let Fly = Delta[1] * 10;
		Fly *= Params.ScrollFlySpeed;
		
		SwitchToDebugCamera(true);
		DebugCamera.OnCameraPanLocal( 0, 0, 0, true );
		DebugCamera.OnCameraPanLocal( 0, 0, Fly, false );
	}
	
	async function XrLoop()
	{
		const Device = await Pop.Xr.CreateDevice( Window );
		
		//	re-use render func
		Device.OnRender = Render;
		
		//	stay in loop here before exiting
		//	request controller poses, this should error if there's a problem and we'll revert to non xr mode
		while ( true )
		{
			await Pop.Yield(100000);
		}
	}
	
	function OnExitXr(Error)
	{
		console.error("XR exited; ",Error);
		//	todo: handle this error/exit and put back a button to
		//	allow player to try and enter again
		Params.XrMode = false;
	}
	
	//	init XR mode
	if ( Params.XrMode )
	{
		XrLoop().then( OnExitXr ).catch( OnExitXr );
	}

}

var Acid = {};

//	use a string if function not yet declared
Acid.State_Intro = 'Intro';
Acid.State_Fly = 'Fly';
Acid.State_ShowAnimal = 'ShowAnimal';
Acid.State_BigBang = 'BigBang';
Acid.State_Outro = 'Outro';
Acid.State_Solution = 'Solution';
Acid.StateMap =
{
	'Intro':		Update_Intro,
	'BigBang':		Update_BigBang,
	'Fly':			Update_Fly,
	'ShowAnimal':	Update_ShowAnimal,
	'Outro':		Update_Outro,
	'Solution':		Update_Solution
};
Acid.StateMachine = new Pop.StateMachine( Acid.StateMap, Acid.State_Intro, Acid.State_Intro, true );
Acid.SelectedActor = null;
Acid.SkipSelectedAnimal = false;
Acid.FogLerp = 0;
Acid.FogTargetPosition = null;
Acid.UserSetYear = null;
Acid.CameraPosition = null;	//	current pos for lerping depending on state
Acid.GetCameraPosition = function()
{
	if ( !Acid.CameraPosition )
		throw "this should have been set before use";
	return Acid.CameraPosition;
}
Acid.GetFogParams = function()
{
	let TargetPos = Acid.FogTargetPosition || [0,0,0];
	
	const FogParams = {};
	const CameraPos = Acid.GetCameraPosition();

	//FogParams.WorldPosition = Math.LerpArray( CameraPos, TargetPos, Acid.FogLerp );
	//FogParams.MinDistance = Math.Lerp( Params.FogMinDistance, Params.FogHighlightMinDistance, Acid.FogLerp );
	//FogParams.MaxDistance = Math.Lerp( Params.FogMaxDistance, Params.FogHighlightMaxDistance, Acid.FogLerp );
	FogParams.WorldPosition = CameraPos;
	FogParams.MinDistance = Params.FogMinDistance;
	FogParams.MaxDistance = Params.FogMaxDistance;
	return FogParams;
}

var CameraScene = null;
var Timeline = null;



function UpdateFog(FrameDuration)
{
	if ( Acid.SelectedActor )
	{
		//	update position in case user quickly switches
		let ActorPos = GetActorWorldPos( Acid.SelectedActor );
		if ( !Acid.FogTargetPosition )
			Acid.FogTargetPosition = ActorPos;
		
		Acid.FogTargetPosition = Math.LerpArray( Acid.FogTargetPosition, ActorPos, Params.FogTargetLerpSpeed );
		Acid.FogLerp += Params.FogParamsLerpSpeed;
	}
	else
	{
		Acid.FogLerp -= Params.FogParamsLerpSpeed;
	}
	Acid.FogLerp = Math.clamp( 0, 1, Acid.FogLerp );
}

function Update_ShowAnimal(FirstUpdate,FrameDuration,StateTime)
{
	UpdateFog(FrameDuration);
	
	if ( FirstUpdate )
	{
		//	update hud to the current animal
		//	move/offset camera to focus on it
		const Animal = Acid.SelectedActor.Animal;
		if ( !Animal )
			throw "No selected animal";

		//	no longer selectable
		Acid.SelectedActor.AnimalHasBeenExploded = true;
		
		Hud.Animal_Card.SetVisible(true);
		Hud.Animal_Title.SetValue( Animal.Name );
		Hud.Animal_Description.SetValue( Animal.Description );
		
		Acid.SkipSelectedAnimal = false;
		Hud.Animal_ContinueButton.OnClicked = function()
		{
			if ( AnimalTest )
			{
				Acid.SelectedActor.ResetPhysicsTextures();
			}
			Acid.SkipSelectedAnimal = true;
		}
		
		//	play a nosie!
		AudioManager.PlaySound( AnimalSelectedSoundFilename );
	}
	
	Update( FrameDuration );

	//	lerp camera to pos
	let TargetCameraPos = GetActorWorldPos(Acid.SelectedActor);
	//	apply offset
	const TargetOffset = [ Params.ShowAnimal_CameraOffsetX, Params.ShowAnimal_CameraOffsetY, Params.ShowAnimal_CameraOffsetZ ];
	TargetCameraPos = Math.Add3( TargetCameraPos, TargetOffset );
	//	move camera
	Acid.CameraPosition = Math.Lerp3( Acid.CameraPosition, TargetCameraPos, Params.ShowAnimal_CameraLerpInSpeed );
	
	
	
	if ( StateTime > Params.ShowAnimal_ExplodeSecs )
	{
		if ( !Acid.SelectedActor.UpdatePhysics )
		{
			Acid.SelectedActor.UpdatePhysics = true;
			AudioManager.PlaySound( AnimalDissolveSoundFilename );
		}
	}
	
	//	never exit
	if ( AnimalTest )
		return;
	
	let Finished = false;
	if ( StateTime > Params.ShowAnimal_Duration )
		Finished = true;

	if ( Acid.SkipSelectedAnimal )
		Finished = true;
	
	if ( !Finished )
		return;
	
	//	hide hud
	Hud.Animal_Card.SetVisible(false);
	
	return Acid.State_Fly;
}



function Update_Intro(FirstUpdate,FrameDuration,StateTime)
{
	if ( FirstUpdate )
	{
	}
	
	Update( FrameDuration );
	UpdateYearTime( FrameDuration );

	//	move camera
	{
		const TimelineCameraPos = GetTimelineCameraPosition( Params.TimelineYear );
		let TargetCameraPos = TimelineCameraPos;
		Acid.CameraPosition = Math.Lerp3( Acid.CameraPosition, TargetCameraPos, Params.ShowAnimal_CameraLerpOutSpeed );
	}
	
	UpdateFog(FrameDuration);
	
	//	fly until we hit big bang
	if ( Params.TimelineYear >= TimelineBigBangYear )
		return Acid.State_BigBang;
	
	//	stay flying
	return null;
}

function UpdateYearTime(FrameDuration)
{
	const YearsPerFrame = FrameDuration * Params.YearsPerSecond;
	Params.TimelineYear += YearsPerFrame;
	if ( ParamsWindow )
		ParamsWindow.OnParamChanged('TimelineYear');
}

function Update_BigBang(FirstUpdate,FrameDuration,StateTime)
{
	if ( FirstUpdate )
	{
		//	explode all bigbang nodes
		function IsBigBangActor(Actor)
		{
			return Actor.Name.startsWith( BigBangAnimalPrefix );
		}
		const BigBangActors = GetActorScene( IsBigBangActor );
		function Explode(Actor)
		{
			Actor.UpdatePhysics = true;
			Actor.AnimalHasBeenExploded = true;
		}
		BigBangActors.forEach( Explode );
		
		//	play a big bang sound
		AudioManager.PlaySound( ExplosionSoundFilename );
	}
	
	UpdateFog( FrameDuration );
	Update( FrameDuration );
	UpdateYearTime( FrameDuration );

	
	if ( StateTime < BigBangDuration )
		return null;
	
	return Acid.State_Fly;
}


function Update_Outro(FirstUpdate,FrameDuration,StateTime)
{
	if ( FirstUpdate )
	{
		
	}
	
	Update( FrameDuration );
	
	//	move time along
	UpdateYearTime( FrameDuration );
	
	//	move camera
	{
		const TimelineCameraPos = GetTimelineCameraPosition( Params.TimelineYear );
		let TargetCameraPos = TimelineCameraPos;
		Acid.CameraPosition = Math.Lerp3( Acid.CameraPosition, TargetCameraPos, Params.ShowAnimal_CameraLerpOutSpeed );
	}
	
	Acid.SelectedActor = null;
	
	UpdateFog(FrameDuration);
	
	//	fly until we reach end of timeline
	if ( Params.TimelineYear >= TimelineSolutionYear )
		return Acid.State_Solution;
	
	//	stay flying
	return null;
}

function Update_Solution(FirstUpdate,FrameDuration,StateTime)
{
	if ( FirstUpdate )
	{
		const SolutionHud = new Pop.Hud.Label('Solution');
		SolutionHud.SetVisible(true);
	}

	Update(FrameDuration);
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

	Update( FrameDuration );
	
	//	move time along
	if ( Acid.UserSetYear !== null )
	{
		//	pop user's year
		Params.TimelineYear = Acid.UserSetYear;
		Acid.UserSetYear = null;
		if ( ParamsWindow )
			ParamsWindow.OnParamChanged('TimelineYear');
	}
	else
	{
		UpdateYearTime( FrameDuration );
	}

	//	move camera
	{
		const TimelineCameraPos = GetTimelineCameraPosition( Params.TimelineYear );
		let TargetCameraPos = TimelineCameraPos;
		Acid.CameraPosition = Math.Lerp3( Acid.CameraPosition, TargetCameraPos, Params.ShowAnimal_CameraLerpOutSpeed );
	}
	
	//	check for animal selection
	function CompareNearest(IntersectionA,IntersectionB)
	{
		const za = IntersectionA.Position[2];
		const zb = IntersectionB.Position[2];
		if ( za < zb )	return -1;
		if ( za > zb )	return 1;
		return 0;
	}

	function GetActorFromUv(uv)
	{
		if ( !LastMouseRayUv )
			return null;
		
		const IntersectedActors = GetActorIntersections(uv);
		if ( IntersectedActors.length == 0 )
			return null;
		//	sort by nearest!
		IntersectedActors.sort( CompareNearest );
		let ActorSelectedActor = IntersectedActors[0].Actor;
		return ActorSelectedActor;
	}
	
	//	update highlight
	let HighlightedActor = GetActorFromUv( LastMouseRayUv );
	let HighlightedActorClicked = false;
	if ( LastMouseClicks.length > 0 )
	{
		let LastClickUv =  LastMouseClicks[LastMouseClicks.length-1];
		LastMouseClicks.length = 0;
		let LastClickActor = GetActorFromUv( LastClickUv );
		if ( LastClickActor )
		{
			HighlightedActor = LastClickActor;
			HighlightedActorClicked = true;
		}
	}

	Acid.SelectedActor = HighlightedActor;
	
	UpdateFog(FrameDuration);
	
	
	if ( HighlightedActorClicked )
	{
		return Acid.State_ShowAnimal;
	}
	
	//	fly until we reach end of timeline
	if ( Params.TimelineYear >= TimelineMaxInteractiveYear )
		return Acid.State_Outro;
	
	//	stay flying
	return null;
}

const LastUpdateColourTextureElapsed = {};
function UpdateColourTexture(FrameDuration,Texture,ColourNamePrefix)
{
	if ( LastUpdateColourTextureElapsed[ColourNamePrefix] !== undefined )
	{
		LastUpdateColourTextureElapsed[ColourNamePrefix] += FrameDuration;
		if ( !Params.CustomiseWaterColours )
		{
			if ( LastUpdateColourTextureElapsed[ColourNamePrefix] < Params.UpdateColourTextureFrequencySecs )
				return;
			if ( !EnableColourTextureUpdate )
				return;
		}
	}
	else
	{
		LastUpdateColourTextureElapsed[ColourNamePrefix] = 0;
	}
	
	//	get all the values
	let Colours = [];
	let ColourSize = 3;
	
	for ( let i=0;	i<20;	i++ )
	{
		const ParamName = ColourNamePrefix + i;
		if ( !Params.hasOwnProperty(ParamName) )
			break;
		Colours.push( ...Params[ParamName] );
		ColourSize = Params[ParamName].length;
	}
	//	as bytes
	Colours = Colours.map( c => c*255 );
	
	
	//	pad to pow2
	let ColourCount = Colours.length / ColourSize;
	let PaddedColourCount = Math.GetNextPowerOf2(ColourCount);
	for ( let i=ColourCount;	i<PaddedColourCount;	i++ )
	{
		let c = (i%ColourCount)*3;
		Colours.push( Colours[c+0] );
		Colours.push( Colours[c+1] );
		Colours.push( Colours[c+2] );
	}
	
	Texture.SetLinearFilter(true);
	Colours = new Uint8Array(Colours);
	ColourCount = Colours.length / ColourSize;
	const Height = 1;
	Texture.WritePixels( ColourCount, Height, Colours, 'RGB' );
}



function Update(FrameDurationSecs)
{
	if ( AppTime === null )
		Init();
	
	//	gr: continue physics even if paused
	//AppTime += FrameDurationSecs;
	AppTime += 1/60;

	const Time = Params.TimelineYear;
	
	//	update audio
	const CurrentMusic = Timeline.GetUniform( Time, 'Music' );
	AudioManager.SetMusic( Params.EnableMusic ? CurrentMusic : null );
	
	const CurrentMusic2 = Timeline.GetUniform( Time, 'Music2' );
	AudioManager.SetMusic2( Params.EnableMusic ? CurrentMusic2 : null );

	if ( EnableVoiceOver )
	{
		const CurrentVoice = Timeline.GetUniform( Time, 'VoiceAudio' );
		AudioManager.PlayVoice( CurrentVoice );
	}
	AudioManager.Update( FrameDurationSecs );

	//	update some stuff from timeline
	Params.FogColour = Timeline.GetUniform( Time, 'FogColour' );
	if ( ParamsWindow )
		ParamsWindow.OnParamChanged('FogColour');
	
	//	update hud
	Hud.YearLabel.SetValue( Math.floor(Params.TimelineYear) );
	Hud.YearSlider.SetValue( Params.TimelineYear );
	const MusicDebug = AudioManager.GetMusicQueueDebug();
	const Music2Debug = AudioManager.GetMusic2QueueDebug();
	const VoiceDebug = AudioManager.GetVoiceQueueDebug();
	const Subtitle = Timeline.GetUniform( Time, 'Subtitle' );
	Hud.MusicLabel.SetValue( MusicDebug );
	Hud.Music2Label.SetValue( Music2Debug );
	Hud.VoiceLabel.SetValue( VoiceDebug );
	Hud.SubtitleLabel.SetValue( Subtitle );
	Hud.SubtitleLabel.SetVisible( Subtitle.length > 0 );

	const DecimalPlaces = 2;
	const Stats_Temp = Timeline.GetUniform( Time, 'Stats_Temp' ).toFixed(DecimalPlaces);
	const Stats_Co2 = Timeline.GetUniform( Time, 'Stats_Co2' ).toFixed(DecimalPlaces);
	const Stats_Oxygen = Timeline.GetUniform( Time, 'Stats_Oxygen' ).toFixed(DecimalPlaces);
	const Stats_Ph = Timeline.GetUniform( Time, 'Stats_Ph' ).toFixed(DecimalPlaces);
	Hud.Stats_Temp.SetValue( Stats_Temp );
	Hud.Stats_Co2.SetValue( Stats_Co2 );
	Hud.Stats_Oxygen.SetValue( Stats_Oxygen );
	Hud.Stats_Ph.SetValue( Stats_Ph );
	
	Hud.Debug_State.SetValue( "State: " + Acid.StateMachine.CurrentState );
	
	try
	{
		const TextureHeapCount = Window.TextureHeap.AllocCount;
		const TextureHeapSizeMb = Window.TextureHeap.AllocSize / 1024 / 1024;
		Hud.Debug_TextureHeap.SetValue("Textures x" + TextureHeapCount + " " + TextureHeapSizeMb.toFixed(2) + "mb" );
		const GeometryHeapCount = Window.GeometryHeap.AllocCount;
		const GeometryHeapSizeMb = Window.GeometryHeap.AllocSize / 1024 / 1024;
		Hud.Debug_GeometryHeap.SetValue("Geometry x" + GeometryHeapCount + " " + GeometryHeapSizeMb.toFixed(2) + "mb" );
	}
	catch(e)
	{
		//Pop.Debug(e);
	}
	
	//	update some huds
	const Hint_ClickAnimal_Visible = Timeline.GetUniform( Time, 'HintClickAnimalVisible' );
	const Hint_DragTimeline_Visible = Timeline.GetUniform( Time, 'HintDragTimelineVisible' );
	const Stats_Visible = Timeline.GetUniform( Time, 'StatsVisible' );
	const Timeline_Visible = Timeline.GetUniform( Time, 'TimelineVisible' );
	Hud.Hint_ClickAnimal.SetVisible( Hint_ClickAnimal_Visible );
	Hud.Hint_DragTimeline.SetVisible( Hint_DragTimeline_Visible );
	Hud.Stats.SetVisible( Stats_Visible );
	Hud.Timeline.SetVisible( Timeline_Visible );

	//	update colours
	if ( !Params.CustomiseWaterColours )
	{
		const UpdateReflection = true;	//	gr: thought this might be a hit updating the dom, but it's not
		const DebrisColours = Timeline.GetUniform( Time, 'DebrisColours' );
		const OceanColours = Timeline.GetUniform( Time, 'OceanColours' );

		function CopyValue(Value,Index,NamePrefix)
		{
			let Name = NamePrefix + Index;
			Params[Name] = Value || InvalidColour;
			if ( UpdateReflection )
				ParamsWindow.OnParamChanged(Name);
		}
		function CopyValues(Array,NamePrefix)
		{
			for ( let i=0;	i<10;	i++ )
				CopyValue( Array[i], i, NamePrefix );
		}
		CopyValues( DebrisColours, 'Debris_Colour' );
		CopyValues( OceanColours, 'Ocean_Colour' );
	}
	
	UpdateColourTexture( FrameDurationSecs, OceanColourTexture, 'Ocean_Colour' );
	UpdateColourTexture( FrameDurationSecs, DebrisColourTexture, 'Debris_Colour' );

	//	update frame rate
	if ( !Params.CustomYearsPerSecond )
	{
		Params.YearsPerSecond = Timeline.GetUniform( Time, 'YearsPerSecond' );
		ParamsWindow.OnParamChanged('YearsPerSecond');
	}
	
	UpdateSceneVisibility(Time);
	
	//	reset render stats
	let Stats = "Batches: " + Pop.Opengl.BatchesDrawn;
	Stats += " Triangles: " + Pop.Opengl.TrianglesDrawn;
	Stats += " Geo Binds: " + Pop.Opengl.GeometryBinds;
	Stats += " Shader Binds: " + Pop.Opengl.ShaderBinds;
	Hud.Debug_RenderStats.SetValue(Stats);
	Pop.Opengl.BatchesDrawn = 0;
	Pop.Opengl.TrianglesDrawn = 0;
	Pop.Opengl.GeometryBinds = 0;
	Pop.Opengl.ShaderBinds = 0;
	
	//
	FirstRenderThisFrame = true;
	RenderFrameDurationSecs = FrameDurationSecs;
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
			//	gr: we assume that if its hidden, its gone behind us
			//		if it's an animal, lets delete the texture data
			if ( IsAutoClearTextureActor(Actor) )
				Actor.ClearOpenglTextures();
		}
		if ( Actor.IsVisible )
			VisibleActorCount++;
	}
	const Actors = GetActorScene( function(){return true;} );
	Actors.forEach( UpdateActorVisibility );
	
	Hud.Debug_VisibleActors.SetValue("Visible Actors: " + VisibleActorCount + "/" + Actors.length );
}




var FirstRenderThisFrame = true;
var RenderFrameDurationSecs = false;

function Render(RenderTarget,RenderCamera)
{
	const RenderContext = RenderTarget.GetRenderContext();
	const IsXrRender = (RenderCamera != null);
	
	//	if we don't have a camera from XR, use the normal system
	if ( !RenderCamera )
	{
		RenderCamera = GetRenderCamera();
		//	skip render in xr mode atm
		if ( Params.XrMode )	return;
	}
	else
	{
		//	turn the XR camera setup into a pop camera
		const Camera = new Pop.Camera();
		Object.assign( Camera, RenderCamera );
		Camera.Position[0] = RenderCamera.Transform.position.x;
		Camera.Position[1] = RenderCamera.Transform.position.y;
		Camera.Position[2] = RenderCamera.Transform.position.z;
		//Pop.Debug("Render with xr camera",Camera);
		
		RenderCamera = Camera;
	}

	if ( false )
	{
		Pop.Debug("render",RenderCamera);
		if ( RenderCamera.Name == 'Left' )
			RenderTarget.ClearColour( 1,0,0 );
		else if ( RenderCamera.Name == 'Right' )
			RenderTarget.ClearColour( 0,1,0 );
		else
			//RenderTarget.ClearColour( ...Params.FogColour );
			RenderTarget.ClearColour( 0,0,1 );
		return;
	}
	
	//	update app logic
	//let DurationSecs = Acid.StateMachine.LoopIteration( !Params.ExperiencePlaying );
	//	stop div by zero
	//DurationSecs = Math.max( DurationSecs, 0.001 );
	const DurationSecs = RenderFrameDurationSecs;
	
	
	const Time = Params.TimelineYear;

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
	const Scene = GetRenderScene( GetActorScene, Time, IsActorVisible );

	const UpdateActorPhysics = function(Actor)
	{
		//	only update actors visible
		//	gr: maybe do this with the actors in scene from GetRenderScene?
		if ( !IsActorVisible(Actor) )
			return;
		const UpdatePhysicsUniforms = function(Shader)
		{
			const Bounds = Actor.BoundingBox.Min.concat( Actor.BoundingBox.Max );
			Shader.SetUniform('OrigPositionsBoundingBox',Bounds);
		}
		Actor.PhysicsIteration( DurationSecs, AppTime, RenderTarget, UpdatePhysicsUniforms );
	}
	
	
	function GpuUpdate()
	{
		const NoiseTime = AppTime * Params.Turbulence_TimeScalar;
		UpdateNoiseTexture( RenderTarget, Noise_TurbulenceTexture, Noise_TurbulenceShader, NoiseTime );

		//	update physics
		if ( PhysicsEnabled || PhsyicsUpdateCount == 0 )
		{
			Scene.forEach( UpdateActorPhysics );
			PhsyicsUpdateCount++;
		}
	}
	
	//	one-frame GPU updates
	if ( FirstRenderThisFrame )
	{
		GpuUpdate();
	}
	
	if ( RenderCamera.Name == 'Left' )
		RenderTarget.ClearColour( [1,0,0] );
	else if ( RenderCamera.Name == 'Right' )
		RenderTarget.ClearColour( [0,1,0] );
	else
		//RenderTarget.ClearColour( ...Params.FogColour );
		RenderTarget.ClearColour( [0,0,1] );

	const CameraProjectionTransform = RenderCamera.GetProjectionMatrix(Viewport);
	const WorldToCameraTransform = RenderCamera.GetWorldToCameraMatrix();
	const CameraToWorldTransform = Math.MatrixInverse4x4(WorldToCameraTransform);
	
	const FogParams = Acid.GetFogParams();
	
	
	
	let GlobalUniforms = Object.assign( {}, FogParams );
	GlobalUniforms = Object.assign( GlobalUniforms, Params );
	GlobalUniforms['Fog_MinDistance'] = FogParams.MinDistance;
	GlobalUniforms['Fog_MaxDistance'] = FogParams.MaxDistance;
	GlobalUniforms['Fog_Colour'] = Params.FogColour;
	GlobalUniforms['Fog_WorldPosition'] = FogParams.WorldPosition;

	/*
	GlobalUniforms[Fog_MinDistance',FogParams.MinDistance);
	Shader.SetUniform('Fog_MaxDistance',FogParams.MaxDistance);
	Shader.SetUniform('Fog_Colour',Params.FogColour);
	Shader.SetUniform('Fog_WorldPosition', FogParams.WorldPosition );
	Shader.SetUniform('Light_Colour', Params.LightColour );
	Shader.SetUniform('Light_MinPower', 0.1 );
	Shader.SetUniform('Light_MaxPower', 1.0 );
	 */
	/*
	let RenderSceneActor = function(Actor,ActorIndex)
	{
		const SetGlobalUniforms = function(Shader)
		{
			Shader.SetUniform('WorldToCameraTransform', WorldToCameraTransform );
			Shader.SetUniform('CameraToWorldTransform', CameraToWorldTransform );
			Shader.SetUniform('CameraProjectionTransform', CameraProjectionTransform );
			Shader.SetUniform('Fog_MinDistance',FogParams.MinDistance);
			Shader.SetUniform('Fog_MaxDistance',FogParams.MaxDistance);
			Shader.SetUniform('Fog_Colour',Params.FogColour);
			Shader.SetUniform('Fog_WorldPosition', FogParams.WorldPosition );
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
	*/
	
	function RenderTextureQuad(Texture,TextureIndex)
	{
		if ( !Texture.Pixels )
			return;
		const BlitShader = GetAsset( BlitCopyShader, RenderContext );
		const Quad = GetAsset('Quad',RenderContext);
		
		let w = 0.1;
		let h = 0.2;
		let x = 0.1;
		let y = 0.1 + (TextureIndex*h*1.10);
		const SetUniforms = function(Shader)
		{
			Shader.SetUniform('VertexRect', [x, y, w, h ] );
			Shader.SetUniform('Texture',Texture);
		};
		RenderTarget.DrawGeometry( Quad, BlitShader, SetUniforms );
	}
	
	const DebugTextures = [];
	if ( Params.DebugNoiseTextures && !IsXrRender )
	{
		DebugTextures.push( OceanColourTexture );
		DebugTextures.push( DebrisColourTexture );
		DebugTextures.push( RandomTexture );
		DebugTextures.push( Noise_TurbulenceTexture );
	}
	
	//	render
	RenderScene( Scene, RenderTarget, RenderCamera, Time, GlobalUniforms );
	//Scene.forEach( RenderSceneActor );
	DebugTextures.forEach( RenderTextureQuad );

	
	//	debug stats
	if ( FirstRenderThisFrame )
	{
		Hud.Debug_RenderedActors.SetValue("Rendered Actors: " + Scene.length);
		RenderFrameCounter.Add();

	}

	FirstRenderThisFrame = false;
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

function SwitchToDebugCamera(ForceAutoGrab)
{
	if ( Params.UseDebugCamera )
		return;
	
	//	auto grab always off in non debug
	if ( !IsDebugEnabled() )
		ForceAutoGrab = false;
	
	if ( ForceAutoGrab !== true )
		if ( !Params.AutoGrabDebugCamera )
			return;
	
	Params.UseDebugCamera = true;
	ParamsWindow.OnParamChanged('UseDebugCamera');
}



