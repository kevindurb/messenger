const config: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  iceTransportPolicy: 'all',
};

interface Listenable {
  addEventListener: (event: string, callback: (...args: any[]) => void) => void;
}

const waitFor = <T extends Listenable>(
  event: Parameters<T['addEventListener']>[0],
  target: T,
) =>
  new Promise((resolve) => {
    target.addEventListener(event, resolve);
  });

export class Controller {
  private peerConnection: RTCPeerConnection;
  private $messenger: HTMLTextAreaElement;
  private $input: HTMLInputElement;
  private dataChannel?: RTCDataChannel;
  private iceCandidates: RTCIceCandidate[] = [];

  constructor() {
    this.peerConnection = new RTCPeerConnection(config);
    this.peerConnection.addEventListener(
      'icecandidate',
      this.handleIceCandidate,
    );
    this.peerConnection.addEventListener('datachannel', this.handleDataChannel);
    this.dataChannel = this.peerConnection.createDataChannel('messages');
    this.dataChannel.addEventListener('message', this.handleMessage);

    const $input = document.querySelector('#input');
    const $messenger = document.querySelector('#messenger');

    if (!$input || !$messenger) {
      throw new Error('requirements not found');
    }

    this.$input = $input as HTMLInputElement;
    this.$messenger = $messenger as HTMLTextAreaElement;

    this.$input.addEventListener('keypress', this.handleKeyPress);

    this.$messenger.value = '';
  }

  handleMessage = (event: MessageEvent) => {
    this.showMessage(event.data);
  };

  handleIceCandidate = (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate) {
      console.log('Found ICE Candidate', event.candidate);
      this.iceCandidates.push(event.candidate);
    }
  };

  handleDataChannel = (event: RTCDataChannelEvent) => {
    this.dataChannel = event.channel;
    console.log('received data channel');
    this.dataChannel.addEventListener('message', this.handleMessage);
  };

  handleKeyPress = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      this.handleInput(this.$input.value);
      this.$input.value = '';
    }
  };

  handleInput = (value: string) => {
    if (!value) return;

    if (value.startsWith('/')) {
      return this.handleCommand(value);
    }
    return this.sendMessage(value);
  };

  handleCommand = (value: string) => {
    const args = value.substring(1).split(' ');
    const command = args.shift();
    switch (command) {
      case 'host':
        return this.hostSession();
      case 'join':
        return this.joinSession(args.join(' '));
    }
    this.showMessage(`Invalid Command: ${command}`);
  };

  sendMessage = (value: string) => {
    if (this.dataChannel) {
      this.dataChannel.send(value);
    }
  };

  showMessage(message: string) {
    this.$messenger.value += `\n${message}`;
  }

  async createSessionPayload(session: RTCSessionDescriptionInit) {
    await this.waitForIceCandidates();

    return btoa(
      JSON.stringify({
        session,
        iceCandidates: this.iceCandidates,
      }),
    );
  }

  parseSessionPayload(payload: string) {
    return JSON.parse(atob(payload)) as {
      iceCandidates: RTCIceCandidate[];
      session: RTCSessionDescriptionInit;
    };
  }

  async waitForIceCandidates() {
    while (this.peerConnection.iceGatheringState !== 'complete') {
      await waitFor('icegatheringstatechange', this.peerConnection);
    }
  }

  async addIceCandidates(iceCandidates: RTCIceCandidate[]) {
    await Promise.all(
      iceCandidates.map((candidate) => {
        console.log('Adding candidate', candidate);
        return this.peerConnection.addIceCandidate(candidate);
      }),
    );
  }

  async joinSession(response: string) {
    const { iceCandidates, session } = this.parseSessionPayload(response);
    this.showMessage(`joining: ${session.sdp}`);

    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(session),
    );

    await this.addIceCandidates(iceCandidates);

    if (session.type === 'answer') {
      this.showMessage(`Finished session setup!`);
    } else {
      const answer = await this.peerConnection.createAnswer({
        iceRestart: true,
      });
      await this.peerConnection.setLocalDescription(answer);
      const payload = await this.createSessionPayload(answer);

      this.showMessage(`Answer: ${payload}`);
    }
  }

  async hostSession() {
    const offer = await this.peerConnection.createOffer({
      iceRestart: true,
    });
    await this.peerConnection.setLocalDescription(offer);
    const payload = await this.createSessionPayload(offer);

    this.showMessage(`Offer: ${payload}`);
  }
}
