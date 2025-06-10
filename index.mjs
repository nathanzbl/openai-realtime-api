import fs from 'fs';
import dotenv from 'dotenv';
import WebSocket from "ws";
import Speaker from 'speaker';
import recorder from 'node-record-lpcm16';
import { PassThrough } from 'stream';
import wav from 'wav-decoder'; 

dotenv.config();
let audiofileCounter = 0;
process.stdin.setEncoding('utf-8');
const RESPONSE_TYPE_DELTA = "response.audio.delta"
const RESPONSE_TYPE_CONTENT_PART_DONE = "response.content_part.done"
const RESPONSE_TYPE_DONE = "response.done"

/* Define the audio format (PCM) & Empty Buffer */
let audioBuffer = Buffer.alloc(0); 
let recordingObject = null

let speaker = null;
let bufferStream = null;
createNewSpeaker();

/* Utility Methods */
function createNewSpeaker() {
    speaker = new Speaker({
        channels: 1,          
        bitDepth: 16,          
        sampleRate: 24000,   
    });

    bufferStream = new PassThrough();
    bufferStream.pipe(speaker);
}

function addAudioChunk(audioChunk) {
    bufferStream.write(audioChunk);
}

const floatTo16BitPCM = (float32Array) => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < float32Array.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
}

const base64EncodeAudio = (float32Array) => {
    const arrayBuffer = floatTo16BitPCM(float32Array);
    let binary = '';
    let bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000; // 32KB chunk size
    for (let i = 0; i < bytes.length; i += chunkSize) {
      let chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}
  
/* Callback method */
process.stdin.on('data', (input) => {
    const trimmedInput = input.trim().toLowerCase();
    if (trimmedInput === 's') {   
        const file = fs.createWriteStream(`recording/output-${++audiofileCounter}.wav`, { encoding: 'binary' });
        recordingObject =  recorder.record({
            sampleRate: 20000,   
            threshold: 0.5,
            verbose: true
        })
        .stream()
        .pipe(file);
        console.log('Recording...');
        console.log("Enter (q) to quit:")
    }
    else if(trimmedInput === 'q'){
        console.log('Stopping recording...');
        recordingObject.end();
        console.log("recording stopped!\n\n")
        startConversation()
    }
});

function recordAudio() {
    /* Listen for 's' key press to stop recording */
    console.log("Enter (s) to start:")
}

async function startConversation() {
    console.log("Starting conversation thread ...")
    const myAudio = fs.readFileSync(`./recording/output-${audiofileCounter}.wav`);
    const audioBuffer = await wav.decode(myAudio);
    const channelData = audioBuffer.channelData[0];
    const base64AudioData = base64EncodeAudio(channelData);

    console.log("Sending client event.")

    /* Send Client Event */
    ws.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_audio',
                audio: base64AudioData
              }
            ]
          }
    })); 
    ws.send(JSON.stringify({ type: 'response.create' }));
    console.log("Client event sent.")
}

// function incomingMessage(message) {
//     try{
//         const response = JSON.parse(message.toString());
//         if(response.type === RESPONSE_TYPE_DELTA) {
//             const audioChunk = Buffer.from(response.delta, 'base64');
//             audioBuffer = Buffer.concat([audioBuffer, audioChunk]);
//             addAudioChunk(audioChunk);
//         }
//         else if(response.type === RESPONSE_TYPE_DONE) {
//             killSpeaker();
//         }
//         else if (response.type === RESPONSE_TYPE_CONTENT_PART_DONE){
//             const { part } = response;
//             console.log(part.transcript);
//             console.log("\n")
//         }
//     }
//     catch(ex){
//         console.error(ex.toString)
//     }
// }
// function incomingMessage(message) {
//     try {
//         console.log("RAW INCOMING MESSAGE:", message.toString()); // <-- ADD THIS LINE
//         const response = JSON.parse(message.toString());
//         console.log("PARSED RESPONSE TYPE:", response.type); // <-- ADD THIS LINE

//         if(response.type === RESPONSE_TYPE_DELTA) {
//             const audioChunk = Buffer.from(response.delta, 'base64');
//             audioBuffer = Buffer.concat([audioBuffer, audioChunk]);
//             addAudioChunk(audioChunk);
//         }
//         else if(response.type === RESPONSE_TYPE_DONE) {
//             killSpeaker();
//             console.log("Conversation done."); // <-- ADD THIS LINE for confirmation
//         }
//         else if (response.type === RESPONSE_TYPE_CONTENT_PART_DONE){
//             const { part } = response;
//             console.log("Transcript part received:", part.transcript); // <-- MODIFY THIS LINE
//             console.log("\n")
//         } else {
//             console.log("UNHANDLED RESPONSE TYPE:", response.type, response); // <-- ADD THIS LINE for unknown types
//         }
//     }
//     catch(ex){
//         console.error("Error parsing or handling incoming message:", ex); // <-- FIX THIS LINE
//     }
// }

// Add a variable to store the session ID outside your incomingMessage function
let currentSessionId = null;

// ... (keep let currentSessionId = null; at the top)

function incomingMessage(message) {
    try {
        console.log("RAW INCOMING MESSAGE:", message.toString());
        const response = JSON.parse(message.toString());
        console.log("PARSED RESPONSE TYPE:", response.type);

        if (response.type === "session.created") {
            currentSessionId = response.session.id; // Store the session ID
            console.log("Session created with ID:", currentSessionId);
            // Now, send your custom instructions
            sendCustomInstructions(); // No need to pass sessionId here, it's global
        }
        else if(response.type === RESPONSE_TYPE_DELTA) {
            const audioChunk = Buffer.from(response.delta, 'base64');
            audioBuffer = Buffer.concat([audioBuffer, audioChunk]);
            addAudioChunk(audioChunk);
        }
        else if(response.type === RESPONSE_TYPE_DONE) {
            killSpeaker();
            console.log("Conversation done.");
        }
        else if (response.type === RESPONSE_TYPE_CONTENT_PART_DONE){
            const { part } = response;
            console.log("Transcript part received:", part.transcript);
            console.log("\n")
        } else if (response.type === "error") { // Add specific handling for error messages
            console.error("API Error:", response.error.message);
            console.error("Error code:", response.error.code);
            console.error("Error parameter:", response.error.param);
        }
        else {
            console.log("UNHANDLED RESPONSE TYPE:", response.type, response);
        }
    }
    catch(ex){
        console.error("Error parsing or handling incoming message:", ex);
    }
}

// Corrected function to send custom instructions
function sendCustomInstructions() {
    const customInstructions = "You are a compassionate, non-judgmental virtual therapy assistant trained to support users by actively listening, asking thoughtful questions, and reflecting emotions. Your goal is to help users explore their thoughts and feelings, promote self-awareness, and provide emotional support. You are not a licensed therapist and must always remind users that for urgent mental health needs or diagnoses, they should seek help from a qualified mental health professional. Avoid giving medical advice, making diagnoses, or promising outcomes. Speak in a calm, warm, and empathetic tone. Ask open-ended questions to guide users in their own reflection. Keep answers concise, and ensure the conversation stays supportive and respectful."; // <-- CUSTOMIZE THIS!

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error("WebSocket is not open to send instructions.");
        return;
    }

    // This is the key change: remove the top-level session_id
    ws.send(JSON.stringify({
        type: "session.update",
        session: {
            // Only include the properties you want to update
            instructions: customInstructions,
            // You can also change other parameters here, e.g., voice, temperature
            // voice: "shimmer",
            // temperature: 0.5
        }
    }));
    console.log("Sent custom instructions to the model.");
}

function killSpeaker() {
    setTimeout(() =>{
        speaker.end();
        createNewSpeaker();
        recordAudio();
    }, 20000)
}

/* Socket Initialization */
const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
const ws = new WebSocket(url, {
    headers: {
        "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
        "OpenAI-Beta": "realtime=v1",
        "OpenAI-Project": process.env.PROJECT
    },
});

ws.onerror = function (error) {
    console.error('WebSocket Error: ', error.message);
};

ws.on("open", function open() {
    console.log("Connected to server.");
});

ws.on("message", incomingMessage);

recordAudio()

process.stdin.on('data', (input) => {
    const trimmedInput = input.trim().toLowerCase();
    if (trimmedInput === 's') {
        const file = fs.createWriteStream(`recording/output-${++audiofileCounter}.wav`, { encoding: 'binary' });
        recordingObject = recorder.record({
            sampleRate: 20000,
            threshold: 0.5,
            verbose: true
        })
        .stream()
        .pipe(file);
        console.log('Recording...');
        console.log("Enter (q) to quit recording or (e) to exit program:") // <-- Updated prompt
    }
    else if(trimmedInput === 'q'){
        console.log('Stopping recording...');
        if (recordingObject) { // Check if recordingObject exists before calling end()
            recordingObject.end();
        }
        console.log("recording stopped!\n\n")
        startConversation()
    }
    else if (trimmedInput === 'e') { // <-- ADD THIS BLOCK
        console.log('Exiting program...');
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close(); // Close the WebSocket connection gracefully
        }
        if (speaker) {
            speaker.end(); // Stop the speaker
        }
        process.exit(0); // Exit the Node.js process (0 indicates success)
    }
});

// Also update your initial prompt
function recordAudioa() {
    /* Listen for 's' key press to start recording */
    console.log("Enter (s) to start recording or (e) to exit program:") // <-- Updated prompt
}