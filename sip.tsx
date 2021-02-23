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
import { endRing, startRing } from '../helpers/ring';

interface SipCredentials {
  authorizationUsername: string;
  authorizationPassword: string;
  sipAccount: string;
  serverUrl: string;
  idRemoteTag: string;
}

interface SipContextData {
  connect(credentials: SipCredentials): void;
  unregister(): void;
  call(destination: string): void;
  register(): void;
  answer(): void;
  hangup(): void;
  dtmf(signalNumber: string, duration: number): void;
  setExternalNumber(number: string): void;
  setAutoAnswer(active: boolean): void;
  stateExtension: string;
  externalNumber: string;
  isReceivedCall: boolean;
  currentCall: boolean;
  autoAnswer: boolean;
}

const SipContext = createContext<SipContextData>({} as SipContextData);

const SipProvider: React.FC = ({ children }) => {
  const [agent, setAgent] = useState<UserAgent>({} as UserAgent);
  const [stateExtension, setStateExtension] = useState('DISCONNECTED');
  const [server, setServer] = useState('');
  const [externalNumber, setExternalNumber] = useState('');
  const [isReceivedCall, setIsReceivedCall] = useState(false);
  const [remoteTag, setRemoteTag] = useState('');
  const [dialog, setDialog] = useState<Session>({} as Session);
  const [currentCall, setCurrentCall] = useState(false);
  const [autoAnswer, setAutoAnswer] = useState(false);

  const onConnect = useCallback(() => {
    setStateExtension('CONNECTED');
  }, []);

  const onDisconnect = useCallback(() => {
    setStateExtension('DISCONNECTED');
  }, []);

  const onRegister = useCallback(() => {
    setStateExtension('REGISTERED');
  }, []);

  const onInvite = useCallback((invitation: Invitation) => {
    setExternalNumber(invitation.request.from.displayName);
    setDialog(invitation);
    setIsReceivedCall(true);
    setCurrentCall(true);
    startRing();
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
          case SessionState.Establishing:
            endRing();
            break;
          case SessionState.Established:
            handleSetupMedia(dialog);
            break;
          case SessionState.Terminated:
            setExternalNumber('');
            handleCleanMedia();
            setIsReceivedCall(false);
            setCurrentCall(false);
            endRing();
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

  const call = useCallback(
    destination => {
      setExternalNumber(destination);
      const target =
        UserAgent.makeURI(`sip:${destination}@${server.split('//')[1]}`) ||
        ({} as URI);
      const inviter = new Inviter(agent, target);
      inviter.invite();
      setDialog(inviter);
      setCurrentCall(true);
    },
    [agent, server],
  );

  const register = useCallback(() => {
    const registerAgent = new Registerer(agent);
    registerAgent.register().then(() => setStateExtension('CONNECTED'));
  }, [agent]);

  const unregister = useCallback(() => {
    const registerAgent = new Registerer(agent);
    registerAgent.unregister().then(() => {
      setCurrentCall(false);
      setStateExtension('DISCONNECTED');
    });
  }, [agent]);

  const answer = useCallback(() => {
    autoAnswer && (dialog as Invitation).accept();
  }, [dialog, autoAnswer]);

  //TODO Hold
  const hold = useCallback(() => {
    throw new Error('Not Implemented');
  }, []);

  //TODO Unhold
  const unhold = useCallback(() => {
    throw new Error('Not Implemented');
  }, []);

  //TODO Mute
  const mute = useCallback(() => {
    throw new Error('Not Implemented');
  }, []);

  //TODO UnMute
  const unmute = useCallback(() => {
    throw new Error('Not Implemented');
  }, []);

  //TODO Renegociacao em queda do WSS
  const renegotiation = useCallback(() => {
    throw new Error('Not Implemented');
  }, []);

  //TODO Transferencia cega e assitida
  const transfer = useCallback(() => {
    throw new Error('Not Implemented');
  }, []);

  const dtmf = useCallback(
    async (signalNumber: string, duration: number) => {
      const options = {
        requestOptions: {
          body: {
            contentDisposition: 'render',
            contentType: 'application/dtmf-relay',
            content: `Signal=${signalNumber}\r\nDuration=${duration}`,
          },
        },
      };

      dialog.info(options);
    },
    [dialog],
  );

  const hangup = useCallback(async () => {
    switch (dialog.state) {
      case SessionState.Initial:
      case SessionState.Establishing:
        if (dialog instanceof Inviter) {
          dialog.cancel();
          setExternalNumber('');
          setIsReceivedCall(false);
          setCurrentCall(false);
          endRing();
        } else {
          (dialog as Invitation).reject();
          setExternalNumber('');
          setIsReceivedCall(false);
          setCurrentCall(false);
          endRing();
        }
        break;
      case SessionState.Established:
        await dialog.bye();
        setExternalNumber('');
        setCurrentCall(false);
        setIsReceivedCall(false);
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
        dtmf,
        unregister,
        hangup,
        answer,
        setExternalNumber,
        setAutoAnswer,
        stateExtension,
        externalNumber,
        isReceivedCall,
        currentCall,
        autoAnswer,
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
