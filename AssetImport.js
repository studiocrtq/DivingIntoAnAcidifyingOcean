Pop.Include('PopEngineCommon/PopCollada.js');
Pop.Include('PopEngineCommon/PopPly.js');
Pop.Include('PopEngineCommon/PopObj.js');
Pop.Include('PopEngineCommon/PopSvg.js');
Pop.Include('Timeline.js');


function GetCachedFilename(Filename,Type)
{
	if ( !Filename )
		return Filename;
	if ( !Type )
		throw "GetCachedFilename("+Filename+") with no type (" + Type + ")";
	const TypeExtension = '.' + Type + '.json';
	let CachedFilename = Filename;
	CachedFilename = CachedFilename.replace('.dae.json',TypeExtension);
	CachedFilename = CachedFilename.replace('.svg.json',TypeExtension);
	CachedFilename = CachedFilename.replace('.ply',TypeExtension);
	CachedFilename = CachedFilename.replace('.obj',TypeExtension);
	return CachedFilename;
}


function GenerateRandomVertexes(Contents,OnVertex,OnMeta)
{
	for ( let i=0;	i<2000;	i++ )
	{
		let x = Math.random();
		let y = Math.random();
		let z = Math.random();
		OnVertex(x,y,z);
	}
}

var AutoTriangleIndexes = [];
function GetAutoTriangleIndexes(IndexCount)
{
	let OldLength = AutoTriangleIndexes.length;
	while ( AutoTriangleIndexes.length < IndexCount )
		AutoTriangleIndexes.push( AutoTriangleIndexes.length );
	if ( OldLength != AutoTriangleIndexes.length )
		Pop.Debug("New AutoTriangleIndexes.length", AutoTriangleIndexes.length);
	
	//	slice so we don't modify our array, but still the length desired
	//	slow?
	return AutoTriangleIndexes.slice( 0, IndexCount );
	/*
	 Pop.Debug("auto gen triangles",TriangleCount);
	 GeometryAsset.TriangleIndexes = new Int32Array( TriangleCount );
	 for ( let t=0;	t<TriangleCount;	t++ )
	 GeometryAsset.TriangleIndexes[t] = t;
	 */
	
}


function ParseColladaSceneAsModel(Contents,OnVertex,OnMeta)
{
	let OnActor = function(Actor)
	{
		OnVertex( ...Actor.Position );
	}
	let OnSpline = function()
	{
	}
	Pop.Collada.Parse( Contents, OnActor, OnSpline );
}


//	seperate func so it can be profiled
function LoadAssetJson(Filename)
{
	const Contents = Pop.LoadFileAsString( Filename );
	const Asset = JSON.parse( Contents );
	return Asset;
}


function VerifyGeometryAsset(Asset)
{
	if ( typeof Asset.VertexAttributeName != 'string' )
		throw "Asset.VertexAttributeName not a string: " + Asset.VertexAttributeName;
	
	if ( typeof Asset.VertexSize != 'number' )
		throw "Asset.VertexSize not a number: " + Asset.VertexSize;
	
	if ( !Array.isArray(Asset.TriangleIndexes) && Asset.TriangleIndexes != 'auto' )
		throw "Asset.TriangleIndexes not an array: " + Asset.TriangleIndexes;
	
	if ( Asset.VertexBuffer != 'auto_vt' )
		if ( !Array.isArray(Asset.VertexBuffer) )
			throw "Asset.VertexBuffer not an array: " + Asset.VertexBuffer;
	
	if ( Asset.WorldPositions !== undefined )
		if ( !Array.isArray(Asset.WorldPositions) )
			throw "Asset.WorldPositions not an array: " + Asset.WorldPositions;
	
}



function SplineToKeyframes(Positions,CameraPositionUniform)
{
	//	make a new timeline
	const Keyframes = [];
	
	const Times = Object.keys(Positions);
	const PushKeyframe = function(Time)
	{
		const Uniforms = {};
		Uniforms[CameraPositionUniform] = Positions[Time];
		const Keyframe = new TKeyframe( Time, Uniforms );
		Keyframes.push( Keyframe );
	}
	Times.forEach( PushKeyframe );
	
	return Keyframes;
}

function LoadSceneFile(Filename)
{
	const Contents = Pop.LoadFileAsString(Filename);

	if ( Filename.endsWith('.scene.json') )
	{
		const Scene = JSON.parse(Contents);
		return Scene;
	}

	const Scene = {};
	Scene.Actors = [];
	Scene.Keyframes = null;
	
	
	const OnActor = function(Actor)
	{
		Scene.Actors.push( Actor );
	}
	
	const OnSpline = function(Spline)
	{
		//	need to do merging
		if ( Scene.Keyframes != null )
			throw "Scene already has keyframes, handle multiple";
		Scene.Keyframes = SplineToKeyframes( Spline.PathPositions, 'CameraPosition' );
	}
	
	if ( Filename.endsWith('.dae.json') )
		Pop.Collada.Parse( Contents, OnActor, OnSpline );
	else
		throw "Unhandled scene file type " + Filename;
	
	return Scene;
}



function ParseGeometryFile(Contents,ParseFunc)
{
	const Positions = [];
	const Colours = [];
	const Alphas = [];
	const PositionSize = 3;
	const Min = [undefined,undefined,undefined];
	const Max = [undefined,undefined,undefined];

	let Update3 = function(Three,Func,Value3)
	{
		Three[0] = Func( Three[0]||Value3[0], Value3[0] );
		Three[1] = Func( Three[1]||Value3[1], Value3[1] );
		Three[2] = Func( Three[2]||Value3[2], Value3[2] );
	}
	
	const OnVertex = function(x,y,z,d,r,g,b)
	{
		let xyz = [x,y,z];
		Update3( Min, Math.min, xyz );
		Update3( Max, Math.max, xyz );

		Positions.push(...xyz);
		if ( d !== undefined )
			Alphas.push( d );
		
		//	todo: catch float vs 8bit by evaluating max
		//	require all 3
		let rgb = [r,g,b];
		if ( !rgb.some( c => (c===undefined) ) )
			Colours.push( ...rgb );
	}
	
	const OnMeta = function()
	{
	}
	
	ParseFunc( Contents, OnVertex, OnMeta );

	const Geo = {};
	Geo.BoundingBox = {};
	Geo.BoundingBox.Min = Min;
	Geo.BoundingBox.Max = Max;
	Geo.Positions = Positions;
	Geo.PositionSize = PositionSize;
	if ( Colours.length )
		Geo.Colours = Colours;
	if ( Alphas.length )
		Geo.Alphas = Alphas;
	
	return Geo;
}

function ParseGeometryJsonFile(Filename)
{
	const Json = Pop.LoadFileAsString(Filename);
	const Geo = JSON.parse(Json);
	return Geo;
}

function LoadGeometryFile(Filename)
{
	Pop.Debug("LoadGeometryFile("+Filename+")");
	
	let Geo = null;
	if ( Filename.endsWith('.geometry.json') )
	{
		Geo = ParseGeometryJsonFile( Filename );
		return Geo;
	}
	
	if ( Filename.endsWith('.random') )
	{
		Geo = ParseGeometryFile( null, GenerateRandomVertexes );
		return Geo;
	}
	
	const Contents = Pop.LoadFileAsString(Filename);
	const FilenameLower = Filename.toLowerCase();
	if ( FilenameLower.endsWith('.ply') )
	{
		Geo = ParseGeometryFile( Contents, Pop.Ply.Parse );
	}
	else if ( FilenameLower.endsWith('.obj') )
	{
		Geo = ParseGeometryFile( Contents, Pop.Obj.Parse );
	}
	else if ( FilenameLower.endsWith('.dae.json') )
	{
		Geo = ParseGeometryFile( Contents, ParseColladaSceneAsModel );
	}
	else if ( FilenameLower.endsWith('.svg.json') )
	{
		Geo = ParseGeometryFile( Contents, Pop.Svg.Parse );
	}
	else
		throw "Don't know how to load " + Filename;
	
	
	return Geo;
}

