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

type TypeTranfer = 'BLIND' | 'ATTENDED';
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
  transfer(destination: string, typeTranfer: TypeTranfer): void;
  controlMicLocal(state: boolean): boolean;
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
  const [session, setSession] = useState<Session>({} as Session);
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

  const onInvite = useCallback(
    (invitation: Invitation) => {
      if (currentCall) {
        invitation.reject({ statusCode: 486 });
        return;
      }

      setExternalNumber(invitation.request.from.displayName);
      setSession(invitation);

      if (!autoAnswer) {
        setIsReceivedCall(true);
        startRing();
      } else {
        invitation.accept();
      }

      setCurrentCall(true);
    },
    [autoAnswer, currentCall],
  );

  const handleSetupMedia = useCallback(
    (sessionCurrent: Session) => {
      const mediaElement = document.getElementById(
        remoteTag,
      ) as HTMLMediaElement;
      const remoteStream = new MediaStream();

      (sessionCurrent.sessionDescriptionHandler as SessionDescriptionHandler).peerConnection
        ?.getReceivers()
        .forEach(receive => {
          if (receive.track) {
            remoteStream.addTrack(receive.track);
          }
        });

      mediaElement.srcObject = remoteStream;
      mediaElement.play();
    },
    [remoteTag],
  );

  const handleCleanMedia = useCallback(() => {
    const mediaElement = document.getElementById(remoteTag) as HTMLMediaElement;
    mediaElement.srcObject = null;
    mediaElement.pause();
  }, [remoteTag]);

  useEffect(() => {
    if (Object.values(session).length > 0) {
      session.stateChange.addListener(newState => {
        switch (newState) {
          case SessionState.Establishing:
            endRing();
            break;
          case SessionState.Established:
            handleSetupMedia(session);
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
  }, [session, handleSetupMedia, handleCleanMedia]);

  const connect = useCallback(
    async ({
      authorizationPassword,
      authorizationUsername,
      sipAccount,
      serverUrl,
      idRemoteTag,
    }: SipCredentials) => {
      console.warn('de novo');

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
        logBuiltinEnabled: true,

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
    [],
  );

  const call = useCallback(
    destination => {
      setExternalNumber(destination);
      const target =
        UserAgent.makeURI(`sip:${destination}@${server.split('//')[1]}`) ||
        ({} as URI);
      const inviter = new Inviter(agent, target);
      inviter.invite();
      setSession(inviter);
      setCurrentCall(true);
    },
    [agent, server],
  );

  const register = useCallback(() => {
    try {
      const registerAgent = new Registerer(agent);
      registerAgent.register().then(() => setStateExtension('CONNECTED'));
    } catch (e) {
      setStateExtension('DISCONNECTED');
    }
  }, [agent]);

  const unregister = useCallback(() => {
    const registerAgent = new Registerer(agent);
    registerAgent.unregister().then(() => {
      setCurrentCall(false);
      setStateExtension('DISCONNECTED');
    });
  }, [agent]);

  const answer = useCallback(() => (session as Invitation).accept(), [session]);

  //TODO Hold
  const hold = useCallback(() => {
    throw new Error('Not Implemented');
  }, []);

  //TODO Unhold
  const unhold = useCallback(() => {
    throw new Error('Not Implemented');
  }, []);

  const controlMicLocal = useCallback(
    (state: boolean): boolean => {
      const pc = (session.sessionDescriptionHandler as SessionDescriptionHandler)
        .peerConnection;

      if (pc) {
        pc.getReceivers().forEach(receive => {
          receive.track.enabled = state;
        });
        return true;
      }
      return false;
    },
    [session],
  );

  //TODO Renegociacao em queda do WSS
  const renegotiation = useCallback(() => {
    throw new Error('Not Implemented');
  }, []);

  const transfer = useCallback(
    (destination: string, typeTranfer: TypeTranfer) => {
      const target =
        UserAgent.makeURI(`sip:${destination}@${server.split('//')[1]}`) ||
        ({} as URI);

      if (typeTranfer === 'BLIND') {
        session.refer(target);
      } else {
        const replacementSession = new Inviter(agent, target);
        session.refer(replacementSession);
      }
    },
    [session, server, agent],
  );

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

      session.info(options);
    },
    [session],
  );

  const hangup = useCallback(async () => {
    switch (session.state) {
      case SessionState.Initial:
      case SessionState.Establishing:
        if (session instanceof Inviter) {
          session.cancel();
        }
        break;
      case SessionState.Established:
        if (session instanceof Inviter) {
          session.bye();
          setExternalNumber('');
          setCurrentCall(false);
          endRing();
        } else {
          (session as Invitation).reject();
          setExternalNumber('');
          setIsReceivedCall(false);
          setCurrentCall(false);
          endRing();
        }
        break;
      case SessionState.Terminating:
      case SessionState.Terminated:
        await session.bye();
        setExternalNumber('');
        setCurrentCall(false);
        setIsReceivedCall(false);
        throw new Error(
          'Cannot terminate a session that is already terminated',
        );

      default:
        break;
    }
  }, [session]);

  return (
    <SipContext.Provider
      value={{
        connect,
        register,
        call,
        dtmf,
        unregister,
        transfer,
        hangup,
        answer,
        setExternalNumber,
        setAutoAnswer,
        controlMicLocal,
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
