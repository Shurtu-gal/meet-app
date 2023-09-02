import { initializeApp } from "firebase/app";
import firebase from "firebase/app";
import { addDoc, collection, doc, getDoc, getFirestore, onSnapshot, updateDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBwynycRyyNMxWh8b9txkGRVsP43hkMcZw",
  authDomain: "video-sharing-1729.firebaseapp.com",
  projectId: "video-sharing-1729",
  storageBucket: "video-sharing-1729.appspot.com",
  messagingSenderId: "182882535499",
  appId: "1:182882535499:web:deaf15b6b6af51930325ce",
  measurementId: "G-LD8ZK3QC07"
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Elements
const toggleVideoBtn = document.getElementById('localVideoToggle');
const toggleAudioBtn = document.getElementById('localAudioToggle');
const toggleScreenShareBtn = document.getElementById('localScreenToggle');
const leaveBtn = document.getElementById('localLeave');
const callBtn = document.getElementById('call');

const currentCallId = document.getElementById('callIdDisplay');
const currentCallIdInput = document.getElementById('callIdInput');
const joinBtn = document.getElementById('join');

const localVideo = document.getElementById('localVideo') as HTMLVideoElement;
const remoteVideo = document.getElementById('remoteVideo') as HTMLVideoElement;
const localScreenVideo = document.getElementById('localScreen') as HTMLVideoElement;

if(!localVideo || !remoteVideo || !localScreenVideo) {
  throw new Error('Video elements not found');
} 

// Constants
const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global States
const controls = {
  video: false,
  audio: false,
  screenShare: false,
}

const callCollection = collection(db, 'calls');

let localStream : MediaStream = new MediaStream();
let remoteStream : MediaStream = new MediaStream();
let localScreenStream : MediaStream = new MediaStream();

let pc = new RTCPeerConnection(servers);

// If track is added to pc from remote, we add it to remoteStream
pc.ontrack = (event) => {
  console.log(event.streams[0].getTracks())
  event.streams[0].getTracks().forEach(track => {
    remoteStream.addTrack(track);
  });

  setupMedia();
};

// Utils functions
function setupMedia() {
  localVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;
  localScreenVideo.srcObject = localScreenStream;
}

async function addTrack({ track, stream } : toggleParams) {
  stream.addTrack(track);
  pc.addTrack(track, stream);
  setupMedia();
};


async function toggleVideo() {
  controls.video = !controls.video;
  if(controls.video) {
    navigator.mediaDevices.getUserMedia({
      video: controls.video ? {
        width: 400,
        height: 300,
      } : false,
    }).then((stream) => {
      addTrack({ track: stream.getVideoTracks()[0], stream: localStream });
    });

    toggleVideoBtn?.classList.add('active');

    return;
  } else {
    localStream.getVideoTracks().forEach(track => {
      track.stop();
    });

    toggleVideoBtn?.classList.remove('active');
    controls.video = false;
  }
};

async function toggleAudio() {
  controls.audio = !controls.audio;
  if(controls.audio) {
    navigator.mediaDevices.getUserMedia({
      audio: controls.audio,
    }).then((stream) => {
      addTrack({ track: stream.getAudioTracks()[0], stream: localStream });
    });
    
    toggleAudioBtn?.classList.add('active');

    return;
  } else {
    localStream.getAudioTracks().forEach(track => {
      track.stop();
    });

    toggleAudioBtn?.classList.remove('active');
    controls.audio = false;
  }
};

async function toggleScreenShare() {
  controls.screenShare = !controls.screenShare;
  if(controls.screenShare) {
    navigator.mediaDevices.getDisplayMedia({
      video: controls.screenShare ? {
        width: 400,
        height: 300,
      } : false,
    }).then((stream) => {
      addTrack({ track: stream.getVideoTracks()[0], stream: localScreenStream });
    });

    toggleScreenShareBtn?.classList.add('active');

    return;
  } else {
    localScreenStream.getVideoTracks().forEach(track => {
      track.stop();
    });

    toggleScreenShareBtn?.classList.remove('active');
    controls.screenShare = false;
  }
};

toggleVideoBtn?.addEventListener('click', toggleVideo);
toggleAudioBtn?.addEventListener('click', toggleAudio);
// toggleScreenShareBtn?.addEventListener('click', toggleScreenShare);

// Firebase utils
async function listenForAnswer(callId: string) {
  const answerCandidatesCollection = collection(callCollection, callId, 'answerCandidates');

  const unsubscribe = onSnapshot(answerCandidatesCollection, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        await pc.addIceCandidate(candidate);
      }
    });
  });

  return unsubscribe;
}

async function updateCallDocument(callId: string, data: any) {
  const callDocRef = doc(callCollection, callId);
  await updateDoc(callDocRef, data);
}


// WebRTC functions
async function createOffer() {
  const callDoc =  await addDoc(callCollection, { });
  const offerCandidates = collection(callDoc, 'offerCandidates');

  currentCallId && (currentCallId.innerHTML = callDoc.id);

  pc.onicecandidate = (event) => {
    event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
  };

  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  // Add offer
  await updateCallDocument(callDoc.id, { offer });

  // Listen for remote answer
  onSnapshot(callDoc, (snapshot) => {
    const data = snapshot.data();
    if(!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  listenForAnswer(callDoc.id);
};

async function answerCall(callId: string) {
  const callDoc = doc(callCollection, callId);
  const answerCandidates = collection(callDoc, 'answerCandidates');
  const offerCandidates = collection(callDoc, 'offerCandidates');

  pc.onicecandidate = (event) => {
    event.candidate && addDoc(answerCandidates, event.candidate.toJSON());
  };

  // Get offer
  const callData = (await getDoc(callDoc)).data();

  const offerDescription = callData?.offer;
  pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await updateCallDocument(callId, { answer });

  onSnapshot(offerCandidates, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if(change.type === 'added') {
        let data = change.doc.data();
        await pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
};

callBtn?.addEventListener('click', createOffer);
joinBtn?.addEventListener('click', () => answerCall((currentCallIdInput as HTMLInputElement).value));

// setupMedia();