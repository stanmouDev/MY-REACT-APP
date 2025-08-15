import React, { useState } from 'react';

// Main App component
export default function App() {
  // State for the input text (what the user pastes)
  const [inputText, setInputText] = useState('');
  // State for the output text (transcription or translation result)
  const [outputText, setOutputText] = useState('');
  // State to track if the app is currently processing an action
  const [isLoading, setIsLoading] = useState(false);
  // State for error messages
  const [error, setError] = useState('');
  // New state to hold the selected target language for translation
  const [targetLanguage, setTargetLanguage] = useState('en'); // Default to English
  // New state to hold the selected audio file
  const [audioFile, setAudioFile] = useState(null);

  // Helper function to convert base64 audio data to a WAV Blob.
  const pcmToWav = (pcmData, sampleRate) => {
    const pcm16 = new Int16Array(pcmData);
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const buffer = new ArrayBuffer(44 + pcm16.byteLength);
    const view = new DataView(buffer);

    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // RIFF chunk length
    view.setUint32(4, 36 + pcm16.byteLength, true);
    // WAVE format
    writeString(view, 8, 'WAVE');
    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    // fmt sub-chunk length
    view.setUint32(16, 16, true);
    // Audio format (1 = PCM)
    view.setUint16(20, 1, true);
    // Number of channels
    view.setUint16(22, numChannels, true);
    // Sample rate
    view.setUint32(24, sampleRate, true);
    // Byte rate
    view.setUint32(28, byteRate, true);
    // Block align
    view.setUint16(32, blockAlign, true);
    // Bits per sample
    view.setUint16(34, bitsPerSample, true);
    // data sub-chunk
    writeString(view, 36, 'data');
    // data sub-chunk length
    view.setUint32(40, pcm16.byteLength, true);

    // Write PCM data
    let offset = 44;
    for (let i = 0; i < pcm16.length; i++, offset += 2) {
      view.setInt16(offset, pcm16[i], true);
    }

    return new Blob([view], { type: 'audio/wav' });
  };

  // Helper function to write a string to a DataView.
  const writeString = (view, offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // Helper function to decode base64 string to ArrayBuffer.
  const base64ToArrayBuffer = (base64) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

  // Function to handle TTS and play the audio.
  const handleTextToSpeech = async (text) => {
    if (!text) {
      setError('No text to speak.');
      return;
    }

    setIsLoading(true);
    setError('');

    const payload = {
        contents: [{
            parts: [{ text: `Say in a professional tone: ${text}` }]
        }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: "Kore" }
                }
            }
        },
        model: "gemini-2.5-flash-preview-tts"
    };

    const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

    let retries = 0;
    const maxRetries = 5;
    let audioUrl = null;

    while (retries < maxRetries) {
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const result = await response.json();
          const part = result?.candidates?.[0]?.content?.parts?.[0];
          const audioData = part?.inlineData?.data;
          const mimeType = part?.inlineData?.mimeType;

          if (audioData && mimeType && mimeType.startsWith("audio/")) {
            const sampleRateMatch = mimeType.match(/rate=(\d+)/);
            if (sampleRateMatch) {
              const sampleRate = parseInt(sampleRateMatch[1], 10);
              const pcmData = base64ToArrayBuffer(audioData);
              const wavBlob = pcmToWav(pcmData, sampleRate);
              audioUrl = URL.createObjectURL(wavBlob);
              break;
            } else {
              setError("Audio sample rate not found in MIME type.");
            }
          } else {
            setError("Failed to get valid audio data from the API.");
          }
        } else {
          const errorText = await response.text();
          console.error('API Error:', errorText);
          setError(`API Error: ${response.status} - ${errorText}`);
        }
      } catch (e) {
        console.error('Fetch error:', e);
        setError('An unexpected error occurred. Please try again.');
        retries++;
        if (retries < maxRetries) {
            await new Promise(function(res) {
              setTimeout(res, Math.pow(2, retries) * 1000);
            });
        }
      }
    }

    setIsLoading(false);

    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.play();
    }
  };

  // Function to handle transcription/translation API calls.
  const handleProcess = async (mode) => {
    if (!inputText) {
      setError('Please provide text to get started.');
      return;
    }

    setIsLoading(true);
    setError('');
    setOutputText('');

    // Dynamically create the prompt based on the mode and selected language
    let prompt;
    if (mode === 'transcribe') {
      prompt = `Simulate transcribing the following spoken audio represented as text: "${inputText}"`;
    } else { // 'translate' mode
      prompt = `Translate the following text into ${targetLanguage}: "${inputText}"`;
    }

    const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = { contents: chatHistory };
    const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const result = await response.json();
          const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text;
          if (generatedText) {
            setOutputText(generatedText);
          } else {
            setError('Failed to get a response from the API.');
          }
          break; // Exit the retry loop on success
        } else {
          const errorText = await response.text();
          console.error('API Error:', errorText);
          setError(`API Error: ${response.status} - ${errorText}`);
        }
      } catch (e) {
        console.error('Fetch error:', e);
        setError('An unexpected error occurred. Please try again.');
        retries++;
        if (retries < maxRetries) {
            await new Promise(function(res) {
              setTimeout(res, Math.pow(2, retries) * 1000);
            });
        }
      }
    }
    setIsLoading(false);
  };

  // SVG for a microphone logo
  const MicrophoneIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 14c2.21 0 4-1.79 4-4V4c0-2.21-1.79-4-4-4S8 1.79 8 4v6c0 2.21 1.79 4 4 4zM11 20.94V24h2v-3.06c3.68-.35 6.5-3.53 6.5-7.44h-2c0 3.25-2.24 5.92-5.25 6.5V14H12v6.94zm0-2.82c-3.25-.58-5.75-3.25-5.75-6.5h-2c0 3.91 2.82 7.09 6.5 7.44V24h1v-5.88z"/>
    </svg>
  );

  return (
    <div className="min-h-screen bg-orange-100 flex items-center justify-center p-4 font-sans">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-2xl">

        {/* Header Section */}
        <div className="flex flex-col items-center mb-6">
          <MicrophoneIcon />
          <h1 className="text-3xl md:text-4xl font-extrabold text-gray-800 mt-4 text-center">
            AI Audio Transcriber
          </h1>
          <p className="text-gray-500 mt-2 text-center">Simulate transcribing and translating with ease.</p>
        </div>

        {/* File Upload and Input Text Area */}
        <div className="mb-6">
          <label htmlFor="audioFile" className="block text-sm font-medium text-gray-700 mb-2">
            Upload an audio file:
          </label>
          <input
            id="audioFile"
            type="file"
            accept="audio/*"
            onChange={(e) => setAudioFile(e.target.files[0])}
            className="w-full text-gray-700 p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500"
          />
          {audioFile && (
            <p className="mt-2 text-sm text-gray-500">Selected file: {audioFile.name}</p>
          )}

          <label htmlFor="inputText" className="block text-sm font-medium text-gray-700 mt-4 mb-2">
            Or paste audio text here (for simulation):
          </label>
          <textarea
            id="inputText"
            rows="4"
            className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-700"
            placeholder="E.g., 'Hello world, this is a test.'"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          ></textarea>
        </div>

        {/* Language Selection and Action Buttons */}
        <div className="flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-4 mb-6">
          {/* Language Selection */}
          <div className="flex-1">
            <label htmlFor="languageSelect" className="block text-sm font-medium text-gray-700 mb-2">
              Translate to:
            </label>
            <select
              id="languageSelect"
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-700"
            >
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="es">Spanish</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese</option>
              <option value="ar">Arabic</option>
              <option value="hi">Hindi</option>
              <option value="yo">Yoruba</option>
              <option value="ha">Hausa</option>
              <option value="ig">Igbo</option>
              <option value="ak">Twi</option>
              <option value="gaa">Ga</option>
            </select>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col space-y-4 flex-1 md:flex-row md:space-y-0 md:space-x-4">
            <button
              onClick={() => handleProcess('transcribe')}
              className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors duration-200 ${
                isLoading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
              }`}
              disabled={isLoading || !inputText}
            >
              {isLoading ? 'Transcribing...' : 'Transcribe'}
            </button>
            <button
              onClick={() => handleProcess('translate')}
              className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors duration-200 ${
                isLoading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 text-white shadow-md'
              }`}
              disabled={isLoading || !inputText}
            >
              {isLoading ? 'Translating...' : 'Translate'}
            </button>
            <button
              onClick={() => handleTextToSpeech(outputText)}
              className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors duration-200 ${
                !outputText || isLoading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-700 text-white shadow-md'
              }`}
              disabled={!outputText || isLoading}
            >
              {isLoading ? 'Loading Audio...' : 'Speak Output'}
            </button>
          </div>
        </div>

        {/* Status and Output Section */}
        {error && (
          <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg mb-4">
            <p className="font-medium">Error:</p>
            <p>{error}</p>
          </div>
        )}

        {outputText && (
          <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <h3 className="text-xl font-semibold text-gray-800 mb-2">Result</h3>
            <p className="text-gray-600 whitespace-pre-wrap">{outputText}</p>
          </div>
        )}

      </div>
    </div>
  );
}