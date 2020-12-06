import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  UserAgent,
  URI,
  UserAgentOptions,
  Registerer,
  Inviter,
  Invitation,
  SessionState,
  Session,
} from 'sip.js';
import { SessionDescriptionHandler } from 'sip.js/lib/platform/web';

interface SipCredentials {
  authorizationUsername: string;
  authorizationPassword: string;
  sipAccount: string;
  serverUrl: string;
  idRemoteTag: string;
}

interface SipContextData {
  connect(credentials: SipCredentials): void;
  disconnect(): void;
  call(): void;
  register(): void;
  answer(): void;
  hangup(): void;
  setExternalNumber(number: string): void;
  stateExtension: string;
  externalNumber: string;
}

const SipContext = createContext<SipContextData>({} as SipContextData);

const SipProvider: React.FC = ({ children }) => {
  const [agent, setAgent] = useState<UserAgent>({} as UserAgent);
  const [stateExtension, setstateExtension] = useState('DISCONNECTED');
  const [server, setServer] = useState('');
  const [externalNumber, setExternalNumber] = useState('');
  const [remoteTag, setRemoteTag] = useState('');
  const [dialog, setDialog] = useState<Session>({} as Session);

  const onConnect = useCallback(() => {
    setstateExtension('CONNECTED');
  }, []);

  const onDisconnect = useCallback(error => {
    setstateExtension('DISCONNECTED');
  }, []);

  const onRegister = useCallback(registration => {
    setstateExtension('REGISTERED');
  }, []);

  const onInvite = useCallback((invitation: Invitation) => {
    setExternalNumber(invitation.request.from.displayName);
    setDialog(invitation);
  }, []);

  const handleSetupMedia = useCallback(
    (session: Session) => {
      const mediaElement = document.getElementById(
        remoteTag,
      ) as HTMLMediaElement;
      const remoteStream = new MediaStream();
      try {
        (session.sessionDescriptionHandler as SessionDescriptionHandler).peerConnection
          ?.getReceivers()
          .forEach(receive => {
            if (receive.track) {
              remoteStream.addTrack(receive.track);
            }
          });

        mediaElement.srcObject = remoteStream;
        mediaElement.play();
      } catch (e) {
        throw new Error(e);
      }
    },
    [remoteTag],
  );

  const handleCleanMedia = useCallback(() => {
    const mediaElement = document.getElementById(remoteTag) as HTMLMediaElement;
    mediaElement.srcObject = null;
    mediaElement.pause();
  }, [remoteTag]);

  useEffect(() => {
    if (Object.values(dialog).length > 0) {
      dialog.stateChange.addListener(newState => {
        switch (newState) {
          case SessionState.Established:
            handleSetupMedia(dialog);
            break;
          case SessionState.Terminated:
            setExternalNumber('');
            handleCleanMedia();
            break;
          default:
            break;
        }
      });
    }
  }, [dialog, handleSetupMedia, handleCleanMedia]);

  const connect = useCallback(
    async ({
      authorizationPassword,
      authorizationUsername,
      sipAccount,
      serverUrl,
      idRemoteTag,
    }: SipCredentials) => {
      const transportOptions = {
        server: serverUrl,
      };

      setRemoteTag(idRemoteTag);
      const uri = UserAgent.makeURI(`sip:${sipAccount}`) || ({} as URI);
      const userAgentOptions: UserAgentOptions = {
        authorizationPassword,
        authorizationUsername,
        transportOptions,
        sessionDescriptionHandlerFactoryOptions: {
          constraints: { audio: true, video: false },
        },
        delegate: {
          onConnect,
          onDisconnect,
          onRegister,
          onInvite,
        },
        uri,
      };

      const userAgent = new UserAgent(userAgentOptions);
      const register = new Registerer(userAgent);
      await userAgent.start();
      setServer(serverUrl);
      setAgent(userAgent);
      register.register();
    },
    [onConnect, onDisconnect, onRegister, onInvite],
  );

  const call = useCallback(() => {
    const target =
      UserAgent.makeURI(`sip:${externalNumber}@${server.split('//')[1]}`) ||
      ({} as URI);
    const inviter = new Inviter(agent, target);
    inviter.invite();
    setDialog(inviter);
  }, [agent, server, externalNumber]);

  const register = useCallback(() => {
    const registerAgent = new Registerer(agent);
    registerAgent.register();
  }, [agent]);

  const disconnect = useCallback(() => {
    agent.stop();
  }, [agent]);

  const answer = useCallback(() => (dialog as Invitation).accept(), [dialog]);

  //TODO Hold
  //TODO Unhold
  //TODO Mute
  //TODO UnMute
  //TODO DTMF

  const hangup = useCallback(async () => {
    switch (dialog.state) {
      case SessionState.Initial:
      case SessionState.Establishing:
        if (dialog instanceof Inviter) {
          dialog.cancel();
          setExternalNumber('');
        } else {
          (dialog as Invitation).reject();
          setExternalNumber('');
        }
        break;
      case SessionState.Established:
        await dialog.bye();
        setExternalNumber('');
        break;
      case SessionState.Terminating:
      case SessionState.Terminated:
        throw new Error(
          'Cannot terminate a session that is already terminated',
        );

      default:
        break;
    }
  }, [dialog]);

  return (
    <SipContext.Provider
      value={{
        connect,
        register,
        call,
        disconnect,
        hangup,
        answer,
        setExternalNumber,
        stateExtension,
        externalNumber,
      }}
    >
      {children}
    </SipContext.Provider>
  );
};

function useSip(): SipContextData {
  const context = useContext(SipContext);
  if (!context) {
    throw new Error('useSip must be used within an SipProvider');
  }

  return context;
}

export { SipProvider, useSip };
