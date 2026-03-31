we are using SUPABASE for the BACKEND.

out goal is to make a perfect BITCIN TRUST SECURITY MESSAGING APP.

1-username of the account must be encrypted and no one can see the real username only friends can see each other username after acceptance of friend request.

2-user UUID derived from the private key and its publicly saved in the database for adding and other things to work properly, only the ID is publicly visible and shows normally, all other datas encrypted with respect of the data relation with owner or friends.

3-every request that sends to the backend or received to the cliend must be encrypted and no one can't see whats happening only the owner, but if its a shared send or receive things like messages or reactions or read receipt or indicators like edited or timestamps of the messages then only the two user that related to the chat can see the actual data, no one must not knowledge about anything even the servers.

every single actons must follow edge + ratchet with the strongest encruption algorithm route.

4-because of the heavy encryption and decryption process we will make the user not feel those delay when doing actions by mimicing the UI to instantly perform the prints and update itself (when possible) like when a user sends message the UI will instantly print the message in the view of the user while the app process the sending message in the background and send to the server, also same applied for sending friend request or accepting friend request or reacting a message or editing a message or removing a message (for me/for everyone) or removing a chat from the chat lists or any other related things that can be instant on the view of the user while processing in the background.

5-now let me tell you about buttons:

-edit: edit messages. 
-delete for me (messages): delete the message only for that user and still persisit for the other user and its irreversable as the chat goes hidden for that user who performed 'delete for me' permanently. both user has permission to delete for me for both messages (sent/received just like telegram).

-delete for everyone (message): delete for everyone which wipe the messages on the view of both side instantly and wipe the messages in the database too, and both user has permission to delete both side messages (sent/received just like telegram).

-delete for me (chats): delete the chat only for that user and still persisit for the other user and its irreversable as the chat goes hidden for that user who performed 'delete for me' permanently. both user has permission to delete for me for both messages (sent/received just like telegram).

-delete for everyone (message): delete for everyone which wipe the chat on the view of both side instantly and wipe the chat related records like reactions, messages,metadatas,indicators,read receipt,and all other metadata that related to the chat in the database, and both user has permission to delete both side chat (just like telegram).

6-username will be exchanged only when the receiver of the friend reqeust accept the reqeust and that thing will be revert when the user goes back to unfriend state which the record of friendship get wiped in the database.

7-block button: will do all like (unfriend,deleting the whole chat in cascade, and remove the friend from the friends list, and the other user can't send friend request until the block being remove by the one who enabled the block).

8-the whole application must be compatible standard common languages RTL/LTR and KURDISH/ARABIC & English and other languages too.

9-every single request must follow the ratchet + edge which creates unique key for each request that leaves the device or receive to the device.

10-the app has two pages overall, auth page which has sign in/sign up, during the sign up the user goes throgh three steps, first generate a phrases (which we feature 12/24 phrases mode and the user choose one of them) with the ability of changing the phrase using a button and another button to copy to clipboard, and a checkbox that warn the user that this is the only time he see that phrases as it will never send to server or saved in the app ram or local storage, and when checked the user goes to the next step to verify the phrases with the ability of paste button and featuring remember me which saved the user private key to maintain the validity of tokens and maintain the logged in session also gives the ability to lock this remember me with a PIN + Biometric which adds an extra layer of security like in app lock in telegram which locks the app when the app closed and can be unlocked when the user enters the PIN or Biometric. after verifying the phrase the user prompt to enter a username (which then encrypted and then the account credentials send to the server and recorded successfully).

in all the steps the user see loading indciator if needed like verifying or account creation process or what ever that the user needs to see for better UX.

-sign in: on the sign in section the user sees one 12/24 input fields (which user choose) and another buttons called Saved login which is a drop down of available saved login (those account who enabled remember me) listed there and can be logged in back by tapping it if PIN/Biometric not set, but if PIN/Biometric set then the user prompt to input the PIN or Biometric. then the account will log in successfully.


11-now i will describe the active session route. when user log in for the first time, the APP during the sign (before saying signed in successfully) will issue a new token and load all the needed datas like account username and UUID, and when the user account data is ready then the user goes into the App interface and the rest of the data like messages,chats,friends,new friend request, pending sent friend reqeusts, blocked users,reactions,indicators,metadats) will all be fetched in the background and will be cached to the device immediatly after decryption so the data will be saved in the cache as plaintext and the whole UI depends on that cache which will make the performance works instant for showing messages,friends,chats, and all other things. and the cache will mirror the Database for any changes like UPDATE,WRITE,DELETE,READ, with the proper edge + ratchet combination.

and of course those things is in sync all the time no matter what screen the user sit currently. so the new things will print to the screen instantly when the user jumps between friends list to notifications to chats and so on.

12-unfriend button will wipe the chat in cascade which wipe all the messages reactions metada inside it.

13- the UI features 7 color pallete and the user can get into the settings to change the color palletes (NORDIC, DRACULA, GRUVBOX, GOLD DARK, BLUE DARK, GREEN DARK and most unique modern color palletes FLAT UI and MOOD & LOGIC) + MATERIALS (GLASSMORPHISM, NEUMORPHISM, BENTO GRID, CLAYMORPHISM, SOLID) + UI SHAPES (SHARP EDGE, SOFT ROUNDED, FULLY ROUNDED, ORGANIC/Asymmetric).

14-delete my account will delete the account in cascade with all related chats messages and all metadata.
########################################################################
Project ZChat: The Hardened Zero-Knowledge Specification
1. Identity & Key Generation (The Root of Trust)
Entropy Source: Implementation of BIP-39 with a user choice of 12 or 24 words.

Key Derivation Function (Hardened): * The mnemonic phrase must never be stored.

Use Argon2id (configured with high memory/time cost) to hash the phrase into a 512-bit seed. This protects against specialized brute-force hardware.

Use HKDF (SHA-256) to derive separate, non-correlated keys from that seed: Identity_Key, PreKey_Bundle, and Authentication_Token.

Blind UUID System: To prevent tracking, the publicly visible UUID must be a random Version 4 string. It must not be mathematically derived from the private key. The server only sees a mapping of Random_UUID -> Public_Identity_Key.

2. The "Stealth" Connection & Metadata Strategy
Username Privacy: Usernames are encrypted using AES-256-GCM before being sent to the server. The decryption key is only exchanged between users after a friend request is accepted via a shared secret.

Handshake (The Edge): Use X3DH (Extended Triple Diffie-Hellman). To make this "Top-Tier," implement a Hybrid approach by combining X25519 with ML-KEM (Kyber-768) to ensure the handshake is resistant to future quantum computers.

Metadata Masking: Every action (Read receipts, "is typing" indicators, message edits, reactions) must be treated as a standard encrypted packet within the Ratchet. The server must only see a uniform packet size to prevent traffic analysis.

3. Messaging & The Double Ratchet
Core Protocol: Implement the Double Ratchet Algorithm.

Forward Secrecy: Every single message, edit, or reaction must trigger a "Ratchet Step," ensuring a new header and payload key for every interaction.

Self-Healing: If a specific message key is ever compromised, the next DH-Ratchet turn must automatically restore total security.

4. Secure Data Management (The "Shred" Logic)
Delete for Me: Locally wipes the message and the associated keys from the device. This is irreversible.

Delete for Everyone: Sends a high-priority "Shred Instruction" through the Double Ratchet.

Recipient Side: The app must physically overwrite the database sector containing the message before deleting the entry.

Server Side: Performs a cascade delete of all associated metadata (reactions, timestamps, receipts).

Unfriend/Block: Triggers an immediate local wipe of the entire chat history and metadata on both devices (cascade wipe).

5. Hardened Local Storage & Performance
Encrypted Cache: Unlike standard apps, ZChat must never store data in plaintext on the device.

Implementation: Use SQLCipher (AES-256-GCM) for the local database. The database is only "unlocked" in the device's RAM when the user provides their PIN or Biometric (FaceID/Fingerprint).

Web Workers: To maintain 60 FPS performance during heavy encryption/decryption, all cryptographic tasks must run in a background thread (Web Worker).

Optimistic UI: The UI must instantly display the action (e.g., message appearing in the bubble) while the Web Worker handles the Ratchet rotation and network request in the background.

6. Authentication & UI/UX
Auth Flow: A three-step signup: Generate Phrase -> Verify Phrase -> Encrypted Username Entry.

Session Management: "Remember Me" sessions are protected by an app-level lock. If enabled, the app requires PIN/Biometric to decrypt the local keys and enter the interface.

Visual Standards:

Palettes: Nordic, Dracula, Gruvbox, Gold Dark, Blue Dark, Green Dark, Flat UI, and Mood & Logic.

Materials: Glassmorphism, Neumorphism, Bento Grid, Claymorphism, and Solid.

Shapes: Sharp Edge, Soft Rounded, Fully Rounded, and Organic/Asymmetric.

Localization: Native support for RTL (Kurdish/Arabic) and LTR (English) using logical layout properties.

7. Technology Stack for the Agent
Frontend: React + Vite + Tailwind CSS.

Backend: Supabase (Database & Auth) + Edge Functions (Routing/Signal server).

Crypto Library: libp2p, noble-curves, or SignalProtocol.js.

NOTE: for icons must use SVG shape based instead of EMOJIs.
NOTE: THE UI MUST COMPATIBLE BOTH PHONE AND PC.
NOTE: THE DESIGN MUST MEET THE BEST UX/UI WITH THE MODERN STYLING AND EASE OF USE FOR BOTH PHONE AND PC BROWSER SCREENS EXPREIENCE.



######MANDATORY#####

must use the latest version of the used framework that mostly compatible with our goal.
the UI must be user frindly and modern.

 
