Pop.Include('PopEngineCommon/PopCollada.js');
Pop.Include('PopEngineCommon/PopPly.js');
Pop.Include('PopEngineCommon/PopObj.js');
Pop.Include('PopEngineCommon/PopSvg.js');
Pop.Include('PopEngineCommon/PopMath.js');
Pop.Include('Timeline.js');

const DataTextureWidth = 128;


function GetCachedFilename(Filename,Type)
{
	if ( Filename.startsWith('.') )
		return null;
		
	if ( !Filename )
		return Filename;
	if ( !Type )
		throw "GetCachedFilename("+Filename+") with no type (" + Type + ")";
	
	let TypeExtension = '.' + Type + '.json';
	//	assume it already has this extension
	if ( Type.includes('.') )
		TypeExtension = '.' + Type;
	
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

function GetChannelsFromPixelFormat(PixelFormat)
{
	switch( PixelFormat )
	{
		case 'Greyscale':	return 1;
		case 'RGBA':		return 4;
		case 'RGB':			return 3;
		case 'Float1':		return 1;
		case 'Float2':		return 2;
		case 'Float3':		return 3;
		case 'Float4':		return 4;
	}
	throw "GetChannelsFromPixelFormat unhandled format " + PixelFormat;
}

function ConvertFloatPixelsToFormat(SourcePixels,SourcePixelChannels,DestFormat)
{
	Pop.Debug("ConvertFloatPixelsToFormat",DestFormat);
	const DestChannels = GetChannelsFromPixelFormat( DestFormat );
	const DestBuffer = new Uint8Array( SourcePixels.length / SourcePixelChannels * DestChannels );
	
	function FloatToByte(Value)
	{
		return Math.floor( Value * 255 );
	}
	
	for ( let p=0;	p<SourcePixels.length/SourcePixelChannels;	p++ )
	{
		let SrcIndex = p * SourcePixelChannels;
		let DstIndex = p * DestChannels;
		for ( let i=0;	i<DestChannels;	i++ )
		{
			let Value = 255;
			if ( i < SourcePixelChannels )
				Value = FloatToByte( SourcePixels[SrcIndex+i] );
			DestBuffer[DstIndex+i] = Value;
		}
	}
	return DestBuffer;
}


function LoadGeometryToTextureBuffers(Geo,MaxPositions,ScaleToBounds=undefined,PositionFormat='Float3')
{
	const GetIndexMap = undefined;
	const ScaleByBounds = undefined;
	
	//	mesh stuff
	let PositionSize = Geo.PositionSize;
	let Positions = Geo.Positions;
	let Colours = Geo.Colours;
	let ColourSize = Colours ? 3 : null;
	let Alphas = Geo.Alphas;
	let AlphaSize = Alphas ? 1 : null;
	
	MaxPositions = MaxPositions || Positions.length;
	Positions.length = Math.min( MaxPositions*PositionSize, Positions.length );
	if ( Colours )
		Colours.length = Math.min( MaxPositions*ColourSize, Colours.length );
	if ( Alphas )
		Alphas.length = Math.min( MaxPositions*AlphaSize, Alphas.length );
	
	if ( ScaleByBounds && Positions )
	{
		const PositionCount = Positions.length / PositionSize;
		for ( let p=0;	p<PositionCount;	p++ )
		{
			for ( let v=0;	v<PositionSize;	v++ )
			{
				let i = (p * PositionSize)+v;
				let f = Positions[i];
				f = Math.lerp( ScaleToBounds.Min[v], ScaleToBounds.Max[v], f );
				Positions[i] = f;
			}
		}
		
		//	scale up the geo bounding box
		Geo.BoundingBox.Min = Geo.BoundingBox.Min.slice();
		Geo.BoundingBox.Max = Geo.BoundingBox.Max.slice();
		for ( let i=0;	i<3;	i++ )
		{
			Geo.BoundingBox.Min[i] = Math.lerp( ScaleToBounds.Min[i], ScaleToBounds.Max[i], Geo.BoundingBox.Min[i] );
			Geo.BoundingBox.Max[i] = Math.lerp( ScaleToBounds.Min[i], ScaleToBounds.Max[i], Geo.BoundingBox.Max[i] );
		}
	}
	
	
	//	scale positions
	if ( ScaleToBounds && Positions )
	{
		Pop.Debug("Scaling to ",ScaleToBounds);
		const PositionCount = Positions.length / PositionSize;
		for ( let p=0;	p<PositionCount;	p++ )
		{
			for ( let v=0;	v<PositionSize;	v++ )
			{
				let i = (p * PositionSize)+v;
				let f = Positions[i];
				f = Math.range( Geo.BoundingBox.Min[v], Geo.BoundingBox.Max[v], f );
				f = Math.lerp( ScaleToBounds.Min[v], ScaleToBounds.Max[v], f );
				Positions[i] = f;
			}
		}
		
		//	retain original bounds for normalising
		/*
		//	scale up the geo bounding box
		Geo.BoundingBox.Min = Geo.BoundingBox.Min.slice();
		Geo.BoundingBox.Max = Geo.BoundingBox.Max.slice();
		for ( let i=0;	i<3;	i++ )
		{
			Geo.BoundingBox.Min[i] = Math.lerp( ScaleToBounds.Min[i], ScaleToBounds.Max[i], Geo.BoundingBox.Min[i] );
			Geo.BoundingBox.Max[i] = Math.lerp( ScaleToBounds.Min[i], ScaleToBounds.Max[i], Geo.BoundingBox.Max[i] );
		}
		*/
	}
	
	const AlphaIsPositionW = false;
	if ( AlphaIsPositionW && Alphas && PositionSize < 4 )
	{
		let NewPositions = [];
		for ( let i=0;	i<Positions.length/PositionSize;	i++ )
		{
			let p = i * PositionSize;
			for ( let c=0;	c<PositionSize;	c++ )
			{
				let x = Positions[p+c];
				NewPositions.push(x);
			}
			let a = Alphas[i];
			NewPositions.push(a);
		}
		
		//	positions now 4!
		Positions = NewPositions;
		PositionSize++;
		Alphas = null;
		AlphaSize = null;
	}
	
	//	sort, but consistently
	//	we used to sort for depth, but dont need to any more
	if ( GetIndexMap )
	{
		/*
		 let Map = GetIndexMap(Positions);
		 let NewPositions = [];
		 Map.forEach( i => NewPositions.push(Positions[i]) );
		 Positions = NewPositions;
		 */
	}
	
	let PositionImage = new Pop.Image();
	if ( PositionImage )
	{
		//	pad to square
		const Channels = PositionSize;
		const Width = DataTextureWidth;
		const Height = Math.GetNextPowerOf2( Positions.length / Width / Channels );
		const PixelDataSize = Channels * Width * Height;
		Pop.Debug("Position texture",Width,Height,Channels,"Total",PixelDataSize);
		
		const PixelValues = Positions.slice();
		PixelValues.length = PixelDataSize;
		
		//	convert to 8 bit
		if ( !PositionFormat.startsWith('Float') )
		{
			const Pixels8 = ConvertFloatPixelsToFormat( PixelValues, PositionSize, PositionFormat );
			PositionImage.WritePixels( Width, Height, Pixels8, PositionFormat );
		}
		else
		{
			const Pixels = new Float32Array( PixelValues );
			if ( Pixels.length != PixelDataSize )
				throw "Float32Array size("+Pixels.length+") didn't pad to " + PixelDataSize;
		
			const PixelFormat = 'Float'+Channels;
			PositionImage.WritePixels( Width, Height, Pixels, PixelFormat );
		}
	}
	
	const ColoursAs8Bit = true;
	let ColourImage = null;
	if ( Colours )
	{
		ColourImage = new Pop.Image();
		
		if ( Colours.length / ColourSize != Positions.length / PositionSize )
			throw "Expecting Colours.length ("+Colours.length+") to match Positions.length ("+Positions.length+")";
		//	pad to square
		const Channels = ColourSize;
		const Width = DataTextureWidth;
		const Height = Math.GetNextPowerOf2( Colours.length / Width / Channels );
		const PixelDataSize = Channels * Width * Height;
		Pop.Debug("Colours texture",Width,Height,Channels,"Total",PixelDataSize);
		
		const PixelValues = Colours.slice();
		PixelValues.length = PixelDataSize;
		
		let Pixels,PixelFormat;
		if ( ColoursAs8Bit )
		{
			Pixels = new Uint8Array( PixelValues );
			PixelFormat = Channels == 3 ? 'RGB' : 'RGBA';
		}
		else
		{
			Pixels = new Float32Array( PixelValues );
			PixelFormat = 'Float'+Channels;
		}
		if ( Pixels.length != PixelDataSize )
			throw "Float32Array size("+Pixels.length+") didn't pad to " + PixelDataSize;
		
		ColourImage.WritePixels( Width, Height, Pixels, PixelFormat );
	}
	
	let AlphaImage = null;
	if ( Alphas )
	{
		AlphaImage = new Pop.Image();
		
		if ( Alphas.length/AlphaSize != Positions.length/PositionSize )
			throw "Expecting Alphas.length ("+Alphas.length+") to match Positions.length ("+Positions.length+")";
		//	pad to square
		const Channels = AlphaSize;
		const Width = DataTextureWidth;
		const Height = Math.GetNextPowerOf2( Alphas.length / Width / Channels );
		const PixelDataSize = Channels * Width * Height;
		Pop.Debug("Alphas texture",Width,Height,Channels,"Total",PixelDataSize);
		
		const PixelValues = Alphas.slice();
		PixelValues.length = PixelDataSize;
		
		const Pixels = new Float32Array( PixelValues );
		if ( Pixels.length != PixelDataSize )
			throw "Float32Array size("+Pixels.length+") didn't pad to " + PixelDataSize;
		
		const PixelFormat = 'Float'+Channels;
		AlphaImage.WritePixels( Width, Height, Pixels, PixelFormat );
	}
	
	const Buffers = {};
	Buffers.BoundingBox = Geo.BoundingBox;
	Buffers.PositionTexture = PositionImage;
	Buffers.ColourTexture = ColourImage;
	Buffers.AlphaTexture = AlphaImage;
	Buffers.TriangleCount = Positions.length;
	
	return Buffers;
}


function CopyPixelBufferToPixelBuffer(DestinationRgba,Source,SourceFormat)
{
	function GetSourceRgba_From_Greyscale(PixelIndex)
	{
		const Grey = Source[PixelIndex];
		const Rgba = [ Grey, Grey, Grey, 255 ];
		return Rgba;
	}
	function GetSourceRgba_From_Rgb(PixelIndex)
	{
		const Rgb = Source.slice( PixelIndex*3, (PixelIndex*3)+3 );
		const Rgba = [ Rgb[0], Rgb[1], Rgb[2], 255 ];
		return Rgba;
	}
	function GetSourceRgba_From_Rgba(PixelIndex)
	{
		const Rgba = Source.slice( PixelIndex*4, (PixelIndex*4)+4 );
		return Rgba;
	}
	
	function GetSourceRgbaFunctor()
	{
		switch(SourceFormat)
		{
			case 'Greyscale':	return GetSourceRgba_From_Greyscale;
			case 'RGB':			return GetSourceRgba_From_Rgb;
			case 'RGBA':		return GetSourceRgba_From_Rgba;
		}
		throw "Currently not supporting " + SourceFormat + " to rgba!";
	};
	
	const GetSourceRgba = GetSourceRgbaFunctor();
	for ( let p=0;	p<DestinationRgba.length/4;	p++ )
	{
		const SourceRgba = GetSourceRgba(p);
		DestinationRgba[(p*4)+0] = SourceRgba[0];
		DestinationRgba[(p*4)+1] = SourceRgba[1];
		DestinationRgba[(p*4)+2] = SourceRgba[2];
		DestinationRgba[(p*4)+3] = SourceRgba[3];
	}
	
}

function ImageToPng(Image,OnPngBytes)
{
	try
	{
		const CompressionLevel = 1.0;
		const PngBytes = Image.GetPngData(CompressionLevel);
		OnPngBytes( PngBytes );
		return;
	}
	catch(e)
	{
		Pop.Debug(e);
	}
	
	Pop.Debug("ImageToPng",Image);
	const Canvas = document.createElement('canvas');
	const Width = Image.GetWidth();
	const Height = Image.GetHeight();
	Canvas.width = Width;
	Canvas.height = Height;
	const Context = Canvas.getContext('2d');
	
	const ImageData = Context.createImageData( Width, Height );
	const Pixels = Image.GetPixelBuffer();
	CopyPixelBufferToPixelBuffer( ImageData.data, Pixels, Image.GetFormat() );
	
	//	draw back to canvas
	Context.putImageData( ImageData, 0, 0 );
	
	function OnBlob(PngBlob)
	{
		function OnBlobBuffer(ArrayBuffer)
		{
			OnPngBytes( ArrayBuffer );
		}
		function OnError(Error)
		{
			Pop.Debug("Error getting blob array buffer",Error);
			throw Error;
		}
		PngBlob.arrayBuffer().then( OnBlobBuffer ).catch( OnError );
	}
	Canvas.toBlob( OnBlob, 'image/png', 1.0 );
	/*
	 //	try and use this mozilla extension
	 const PngFile = Canvas.mozGetAsFile("Filename.png", 'image/png' );
	 const PngArrayBuffer = await PngFile.arrayBuffer();
	 return PngArrayBuffer;
	 */
}

function StringToBytes(String)
{
	const Bytes = [];
	for ( let i=0;	i<String.length;	i++ )
	{
		let Char = String.charCodeAt(i) & 0xff;
		Bytes.push(Char);
	}
	return Bytes;
}


function BytesToString(Bytes)
{
	let OutputString = "";
	for ( let i=0;	i<Bytes.length;	i++ )
	{
		let Char = String.fromCharCode( Bytes[i] );
		OutputString += Char;
	}
	return OutputString;
}

const PackedImageFormat = 'RGB';

function PadArray(Bytes,Stride,PaddingString)
{
	if ( PaddingString.length == 0 )
		throw "Padding string needs to be at least 1 byte";
	
	const PadBytes = StringToBytes(PaddingString);
	for ( let p=0;	p<Stride;	p++ )
	{
		//	no more padding needed
		if ( (Bytes.length % Stride) == 0 )
			break;
		Bytes.push( PadBytes[p%PadBytes.length] );
	}
}

//	packed PNG file
//	first line is meta, which describes contents of the following lines
function CreatePackedImage(Contents)
{
	Pop.Debug("Creating packed image",Contents);
	
	//	extract meta & non-meta
	let Meta = {};
	Meta.ImageMetas = [];
	let Images = [];
	
	function PushImage(Name,Image)
	{
		Images.push( Image );
		
		let ImageMeta = {};
		ImageMeta.Width = Image.GetWidth();
		ImageMeta.Height = Image.GetHeight();
		ImageMeta.Format = Image.GetFormat();
		ImageMeta.Name = Name;
		Meta.ImageMetas.push( ImageMeta );
	}
	
	function PushMeta(Name,Content)
	{
		Meta[Name] = Content;
	}
	
	function PushContent(Name)
	{
		const Content = Contents[Name];
		if ( !Content )
			return;
		if ( Content.constructor == Pop.Image )
			PushImage( Name, Content );
		else
			PushMeta( Name, Content );
	}
	const ContentKeys = Object.keys(Contents);
	ContentKeys.forEach( PushContent );
	
	//	encode meta into a line of pixels
	const MetaString = JSON.stringify(Meta);
	const MetaBytes = StringToBytes(MetaString);
	
	//	make image width the length of the byte array so row0 is always meta
	const PackedChannels = GetChannelsFromPixelFormat(PackedImageFormat);
	//	gotta pad the meta to align to channels
	PadArray( MetaBytes, PackedChannels, ' ' );
	const PackedWidth = MetaBytes.length / PackedChannels;

	let Pixels = [];
	//	write meta
	Pixels.push( ...MetaBytes );
	//	write each image
	for ( let i=0;	i<Images.length;	i++ )
	{
		const Image = Images[i];
		const ImagePixels = Image.GetPixelBuffer();
		
		for ( let p=0;	p<ImagePixels.length;	p++ )
			Pixels.push( ImagePixels[p] );
		//	causing callstack error
		//const ImagePixelsArray = Array.from(ImagePixels);
		//Pixels.push( ...ImagePixelsArray );
	}
	
	//	pad with pattern we can read in a hex editor
	const PackedStride = PackedWidth*PackedChannels;
	PadArray( Pixels, PackedStride, 'PAD!' );
	
	const PackedHeight = Pixels.length / PackedStride;
	if ( !Number.isInteger(PackedHeight) )
		throw "We didn't create aligned pixel buffer!";
	
	const PackedImage = new Pop.Image();
	Pixels = new Uint8Array(Pixels);
	PackedImage.WritePixels( PackedWidth, PackedHeight, Pixels, PackedImageFormat );
	return PackedImage;
}

function GetImageAsPopImage(Img)
{
	if ( Img.constructor == Pop.Image )
		return Img;

	//	html5 image
	if ( Img.constructor == HTMLImageElement )
	{
		//	gr: is this really the best way :/
		const Canvas = document.createElement('canvas');
		const Context = Canvas.getContext('2d');
		const Width = Img.width;
		const Height = Img.height;
		Canvas.width = Width;
		Canvas.height = Height;
		Context.drawImage( Img, 0, 0 );
		const ImageData = Context.getImageData(0, 0, Width, Height);
		const Buffer = ImageData.data;
		const PopImage = new Pop.Image();
		PopImage.WritePixels( Width, Height, Buffer, 'RGBA' );
		return PopImage;
	}
	
	Pop.Debug("Dont know how to get pixels from ",Img);
	
	throw "Dont know how to get pixels from " + Img;
}

function BufferToRgb(Buffer,BufferFormat,ChannelCount)
{
	const BufferChannels = GetChannelsFromPixelFormat(BufferFormat);
	if ( BufferChannels == ChannelCount )
		return Buffer;
	
	if ( BufferChannels < ChannelCount )
		throw "Source doesn't have enough data!";
	
	const PixelCount = Buffer.length / BufferChannels;
	const Rgb = new Uint8Array( ChannelCount * PixelCount );
	for ( let p=0;	p<PixelCount;	p++ )
	{
		let si = p * BufferChannels;
		let di = p * ChannelCount;
		Rgb[di+0] = Buffer[si+0];
		Rgb[di+1] = Buffer[si+1];
		Rgb[di+2] = Buffer[si+2];
	}
	return Rgb;
}

function LoadPackedImage(Image)
{
	Image = GetImageAsPopImage(Image);
	let PixelBuffer = Image.GetPixelBuffer();
	const PackedImageChannels = GetChannelsFromPixelFormat(PackedImageFormat);
	PixelBuffer = BufferToRgb( PixelBuffer, Image.GetFormat(), PackedImageChannels );
	
	function GetPixels(PixelIndex,PixelCount,Channels)
	{
		//	get the buffer
		const Slice = PixelBuffer.slice( PixelIndex*Channels, (PixelIndex+PixelCount)*Channels );
		return Slice;
	}
	
	let ByteOffset = 0;
	function PopBytes(Length)
	{
		const Slice = PixelBuffer.slice( ByteOffset, ByteOffset+Length );
		ByteOffset += Length;
		return Slice;
	}
	
	//	first line is meta
	const FirstLineBytes = PopBytes( Image.GetWidth() * PackedImageChannels );
	const FirstLine = BytesToString( FirstLineBytes );
	Pop.Debug("First line from image",FirstLine);
	const Meta = JSON.parse( FirstLine );
	Pop.Debug(Meta);

	const TextureBuffers = {};
	TextureBuffers.BoundingBox = Meta.BoundingBox;
	TextureBuffers.TriangleCount = Meta.TriangleCount;
	
	//	maybe this should be in the renderer, but doing it here means we keep system kinda consistent
	function RescaleImageToFloat(Image,Bounds)
	{
		const PixelBytes = Image.GetPixelBuffer();
		const PixelFloats = new Float32Array( PixelBytes.length );
		const Channels = GetChannelsFromPixelFormat( Image.GetFormat() );
		const FloatFormat = 'Float' + Channels;
		for ( let i=0;	i<PixelBytes.length;	i+=Channels )
		{
			for ( let c=0;	c<Channels;	c++ )
			{
				let f = PixelBytes[i+c] / 255;
				f = Math.lerp( Bounds.Min[c], Bounds.Max[c], f );
				PixelFloats[i+c] = f;
			}
		}
		Image.WritePixels( Image.GetWidth(), Image.GetHeight(), PixelFloats, FloatFormat );
	}
	
	//	pop next images
	for ( let i=0;	i<Meta.ImageMetas.length;	i++ )
	{
		const ImageMeta = Meta.ImageMetas[i];
		const Channels = GetChannelsFromPixelFormat( ImageMeta.Format );
		const Pixels = PopBytes( ImageMeta.Width * ImageMeta.Height * Channels );
		const Image = new Pop.Image();
		Image.WritePixels( ImageMeta.Width, ImageMeta.Height, Pixels, ImageMeta.Format );
		if ( ImageMeta.Name == 'PositionTexture' )
			RescaleImageToFloat( Image, TextureBuffers.BoundingBox );
		TextureBuffers[ImageMeta.Name] = Image;
		Pop.Debug("Loaded image",ImageMeta.Name,Image);
	}
	
	return TextureBuffers;
}

