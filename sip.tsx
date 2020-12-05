import React, { createContext, useCallback, useContext, useState } from 'react';
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

interface SipCredentials {
  authorizationUsername: string;
  authorizationPassword: string;
  sipAccount: string;
  serverUrl: string;
}

interface SipContextData {
  connect(credentials: SipCredentials): void;
  disconnect(): void;
  call(destination: string): void;
  register(): void;
  answer(): void;
  hangup(): void;
  stateExtension: string;
  callerId: string;
}

const SipContext = createContext<SipContextData>({} as SipContextData);

const SipProvider: React.FC = ({ children }) => {
  const [agent, setAgent] = useState<UserAgent>({} as UserAgent);
  const [stateExtension, setstateExtension] = useState('DISCONNECTED');
  const [server, setServer] = useState('');
  const [callerId, setCallerId] = useState('');
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
    setCallerId(invitation.request.from.displayName);
    setDialog(invitation);
  }, []);

  const connect = useCallback(
    async ({
      authorizationPassword,
      authorizationUsername,
      sipAccount,
      serverUrl,
    }: SipCredentials) => {
      const transportOptions = {
        server: serverUrl,
      };

      const uri = UserAgent.makeURI(`sip:${sipAccount}`) || ({} as URI);
      const userAgentOptions: UserAgentOptions = {
        authorizationPassword,
        authorizationUsername,
        transportOptions,
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
      const target =
        UserAgent.makeURI(`sip:${destination}@${server.split('//')[1]}`) ||
        ({} as URI);
      const inviter = new Inviter(agent, target);
      inviter.invite();
      setDialog(inviter);
    },
    [agent, server],
  );

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
        } else {
          (dialog as Invitation).reject();
        }
        break;
      case SessionState.Established:
        await dialog.bye();
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
        stateExtension,
        callerId,
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
