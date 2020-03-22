
//	this needs to evolve into the proper pop API
Pop.Audio = {};

//	replace this!
const DomTriggerPromise = Pop.CreatePromise();

function OnDomTrigger()
{
	DomTriggerPromise.Resolve();
}
window.addEventListener('click',OnDomTrigger,true);
window.addEventListener('touchstart',OnDomTrigger,true);	//	for safari ios

Pop.Audio.DefaultGetGlobalAudioState = function ()
{
	//	if non-null, this result overrides the state of any sound
	const Foreground = Pop.WebApi.IsForeground();
	const Minimised = Pop.WebApi.IsMinimised();

	if (!Foreground || Minimised)
		return 'Pause';

	return null;
}

//	https://gist.github.com/wittnl/8a1a0168b94f3b6abfaa#gistcomment-1551393
const SilentMp3Url = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjM2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU2LjQxAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV';

Pop.Audio.SoundIdCounter = 1000;

Pop.Audio.AllocSoundId = function()
{
	return Pop.Audio.SoundIdCounter++;
}


//	fake audio stub
let AudioFake = function()
{
	this.addEventListener = function(){};
	this.removeEventListener = function(){};
	this.pause = function(){};
	this.load = function(){};
	this.Free = function(){};
	this.play = function()
	{
		return new Promise( function(Resolve,Reject){	Resolve();	} );
	}
}

if ( Pop.GetPlatform() != 'Web' )
{
	//	audio is a web class. (is it window.Audio ?)
	Audio = AudioFake;
}



Pop.Audio.Sound = class
{
	constructor(Url,Loop=false,GetOverrideState)
	{
		this.GetState = function ()
		{
			if (this.HasFinished())
				return 'Stop';

			if (GetOverrideState)
			{
				const OverrideState = GetOverrideState();
				if (OverrideState)
					return OverrideState;
			}
			return this.State;
		}.bind(this);

		this.Url = Url;
		this.Loop = Loop;
		this.StateQueue = new Pop.PromiseQueue();
		this.State = 'Play';
		this.Sound = new Audio();
		this.Error = null;
		this.Sound.src = Url;
		this.AsyncUpdate().then(this.OnFinished.bind(this)).catch(this.OnError.bind(this));
	}

	HasFinished()
	{
		//	we manually stopped
		if (this.Unloaded === true)
			return true;

		return this.Sound.ended;
	}

	Destroy()
	{
		this.SetState('Stop');
	}

	GetSoundState()
	{
		if (!this.Sound)
			return 'null';
		let State = `RequestedState: ${this.State} `;
		State += `paused: ${this.Sound.paused} `;
		State += `SoundError: ${this.Sound.error} `;
		State += `Error: ${this.Error} `;
		return State;
	}

	OnFinished()
	{
		//Pop.Debug("AudioSound OnFinished");
	}

	OnError(Error)
	{
		this.Error = Error;
		Pop.Debug(`Pop.Audio.Sound OnError ${Error}`);
	}

	async AsyncUpdate()
	{
		//	we could ditch this wait and call Play() first and IF there's an error, THEN wait for a click
		await DomTriggerPromise;
		//	load & prep to play
		Pop.Debug("this.Sound.play",this.Sound);
		await this.Sound.play();

		this.Sound.loop = this.Loop;

		//	immediately pause so we're in a ready state
		this.Sound.pause();

		//	set initial state
		Pop.Debug(`InitialState = ${this.State}`);
		this.SyncState();

		//	wait for state to change
		while (true)
		{
			const NewState = await this.StateQueue.Allocate();
			//Pop.Debug(`NewState = ${NewState}`);
			this.SyncState();
		}
	}

	SetVolume(Volume)
	{
		this.Sound.volume = Volume;
	}

	SyncState()//private
	{
		const State = this.GetState();
		//Pop.Debug(`Syncing state: ${State}`);

		//	if not done after async waits, this might error
		if (State == 'Play')
		{
			this.Sound.play();
		}
		else if (State == 'Pause')
		{
			this.Sound.pause();
		}
		else if (State == 'Stop')
		{
			//	there is no stop. Unload
			//this.Sound.stop();
			this.Sound.pause();
			this.Sound.removeAttribute('src'); // empty source
			this.Sound.load();
			this.Unloaded = true;
			if (!this.HasFinished())
				throw "After stop, we should be finished";
		}
		else
			throw `Unhandled state ${State}`;
	}

	SetState(NewState)
	{
		this.State = NewState;
		this.OnStateChanged();
	}

	OnStateChanged()
	{
		const State = this.GetState();
		this.StateQueue.Resolve(State);
	}

	SetStateStop()
	{
		//	stop it playing
		//	https://stackoverflow.com/a/28060352/355753
		//	may need to check its loaded first...
		this.Sound.pause();
		//	"" triggers an error!
		//Sound.src = "";
		this.Sound.src = SilentMp3Url;
		this.Sound.load();
	}
}


const TQueuedAudio = function(Filename,Loop,StartQuiet,GetVolume,GetOverrideState)
{
	//	fades are 0..1. null if not yet invoked
	this.Filename = Filename;
	this.FadeInElapsed = StartQuiet ? 0 : 1;
	this.FadeOutElapsed = null;
	this.Audio = null;
	
	this.IsActive = function()
	{
		//	we've deleted it (fade etc)
		if ( !this.Audio )
			return false;
		//	audio has finished
		if ( this.Audio.HasFinished() )
			return false;
		return true;
	}
	
	this.GetVolume = function()
	{
		let FadeInVolume = this.FadeInElapsed;
		let FadeOutVolume = (this.FadeOutElapsed===null) ? 1 : 1 - this.FadeOutElapsed;
		let Volume = FadeInVolume * FadeOutVolume;
		Volume *= GetVolume();
		return Volume;
	}
	
	this.StartFadeOut = function()
	{
		if ( this.FadeOutElapsed === null )
			this.FadeOutElapsed = 0;
	}
	
	this.Destroy = function()
	{
		if ( !this.Audio )
			return;
		this.Audio.Destroy();
		this.Audio = null;
	}
	
	this.Update = function(FadeStep)
	{
		//	continue fades
		if ( this.FadeInElapsed !== null )
		{
			this.FadeInElapsed = Math.min( 1, this.FadeInElapsed + FadeStep );
		}
		
		if ( this.FadeOutElapsed !== null )
		{
			this.FadeOutElapsed += FadeStep;
			if ( this.FadeOutElapsed > 1 )
			{
				this.FadeOutElapsed = 1;
				this.Destroy();
			}
		}
		
		//	update volume
		if ( this.Audio )
		{
			let Volume = this.GetVolume();
			this.Audio.SetVolume( Volume );
		}
	}

	this.OnStateChanged = function ()
	{
		if (!this.Audio)
			return;
		this.Audio.OnStateChanged();
	}
	
	//	init volume
	if ( Filename !== null )
	{
		this.Audio = new Pop.Audio.Sound(Filename,Loop,GetOverrideState );
		this.Audio.SetVolume(this.GetVolume());
		this.Audio.SetState('Play');
	}

}

const TAudioManager = function(GetCrossFadeDuration,GetMusicVolume,GetMusic2Volume,GetVoiceVolume,GetSoundVolume,GetOverrideState=Pop.Audio.DefaultGetGlobalAudioState)
{
	//	array of TQueuedAudio
	//	the last element in the queue is NOT fading out, every other one is
	this.MusicQueue = [];
	this.Music2Queue = [];
	this.VoiceQueue = [];
	this.Sounds = [];


	this.ForegroundCheckLoop = async function ()
	{
		while (true)
		{
			const IsForeground = await Pop.WebApi.WaitForForegroundChange();
			Pop.Debug("Audio manager foreground change",IsForeground);
			this.Sounds.forEach(s => s.OnStateChanged());
			this.MusicQueue.forEach(s => s.OnStateChanged());
			this.Music2Queue.forEach(s => s.OnStateChanged());
			this.VoiceQueue.forEach(s => s.OnStateChanged());
		}
	}
	this.ForegroundCheckLoop().then().catch(Pop.Debug);

	this.UpdateAudioQueue = function(Queue,FadeStep)
	{
		//	make sure any item not at the end of the queue is fading off
		for ( let i=0;	i<Queue.length-1;	i++ )
			Queue[i].StartFadeOut();
		
		//	update them all
		for ( let i=0;	i<Queue.length;	i++ )
			Queue[i].Update( FadeStep );
		
		//	remove any dead audio
		for ( let i=Queue.length-1;	i>=0;	i-- )
		{
			if ( !Queue[i].IsActive() )
			{
				Queue[i].Destroy();
				Queue.splice( i, 1 );
			}
		}
	}
	
	this.UpdateSounds = function()
	{
		//	delete dead sounds, but also set volume, which will recreate if error
		const SoundVolume = GetSoundVolume();
		function UpdateSound(Sound)
		{
			Sound.SetVolume( SoundVolume );
		}
		this.Sounds.forEach( UpdateSound );
	}
	
	this.Update = function(Timestep)
	{
		const FadeSecs = GetCrossFadeDuration();
		const FadeStep = Timestep / FadeSecs;
		
		this.UpdateAudioQueue( this.MusicQueue, FadeStep );
		this.UpdateAudioQueue( this.Music2Queue, FadeStep );
		this.UpdateAudioQueue( this.VoiceQueue, FadeStep );
		this.UpdateSounds();
	}
	
	this.SetMusic = function(Filename)
	{
		if ( Filename.length == 0 )
			Filename = null;
		
		//	see if this is at the end of the queue
		if ( this.MusicQueue.length > 0 )
		{
			let Last = this.MusicQueue[this.MusicQueue.length-1];
			if ( Last.Filename == Filename )
				return;
		}
		
		let Loop = true;
		let StartQuiet = false;
		let NewSound = new TQueuedAudio(Filename,Loop,StartQuiet,GetMusicVolume,GetOverrideState );
		this.MusicQueue.push( NewSound );
	}
	
	this.SetMusic2 = function(Filename)
	{
		if ( Filename.length == 0 )
			Filename = null;
		
		//	see if this is at the end of the queue
		if ( this.Music2Queue.length > 0 )
		{
			let Last = this.Music2Queue[this.Music2Queue.length-1];
			if ( Last.Filename == Filename )
				return;
		}
		
		let Loop = true;
		let StartQuiet = false;
		let NewSound = new TQueuedAudio(Filename,Loop,StartQuiet,GetMusic2Volume,GetOverrideState );
		this.Music2Queue.push( NewSound );
	}

	this.PlayVoice = function(Filename)
	{
		//	empty string is a blank audio
		if ( !Filename.length )
			Filename = null;
		
		//	see if this is at the end of the queue
		//	gr: change to see if it's in the queue at all?
		if ( this.VoiceQueue.length > 0 )
		{
			let Last = this.VoiceQueue[this.VoiceQueue.length-1];
			if ( Last.Filename == Filename )
				return;
		}
		
		let Loop = false;
		let StartQuiet = false;
		let NewSound = new TQueuedAudio(Filename,Loop,StartQuiet,GetVoiceVolume,GetOverrideState );
		this.VoiceQueue.push( NewSound );
	}
	

	this.GetQueueDebug = function(Queue)
	{
		if ( Queue.length == 0 )
			return "No audio queued";
		
		let Metas = [];
		let PushMeta = function(AudioQueueItem)
		{
			let Volume = AudioQueueItem.GetVolume() * 100;
			Volume = Volume.toFixed(0);
			let Debug = AudioQueueItem.Filename + "@" + Volume + "%";
			Metas.push( Debug );
		}
		Queue.forEach( PushMeta );
		return Metas.join(", ");
	}
	
	this.GetMusicQueueDebug = function()
	{
		return this.GetQueueDebug(this.MusicQueue);
	}
	
	this.GetMusic2QueueDebug = function()
	{
		return this.GetQueueDebug(this.Music2Queue);
	}

	this.GetVoiceQueueDebug = function()
	{
		return this.GetQueueDebug(this.VoiceQueue);
	}
	
	this.PlaySound = function(Filename)
	{
		const Loop = false;
		const Sound = new Pop.Audio.Sound(Filename,Loop,GetOverrideState);
		Sound.Id = Pop.Audio.AllocSoundId();
		this.Sounds.push( Sound );
		Pop.Debug("PlaySound(",Filename);
		return Sound.Id;
	}
	
	this.StopSound = function(SoundId)
	{
		function MatchSound(Sound)
		{
			return Sound.Id == SoundId;
		}
		//	we should queue these and fade out instead of just stopping
		let MatchSounds = this.Sounds.filter( MatchSound );
		this.Sounds = this.Sounds.filter( s => !MatchSound(s) );
		function KillSound(Sound)
		{
			Pop.Debug("Killing sound");
			Sound.Destroy();
		}
		if ( MatchSounds.length == 0 )
			Pop.Debug("Tried to kill sound",SoundId," but no matches");
		MatchSounds.forEach( KillSound );
	}
}
