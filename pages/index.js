import { useEffect, useState } from "react";
import { ethers } from "ethers";
import {
  client,
  challenge,
  checkDispatcher,
  authenticate,
  getDefaultProfile,
  signCreatePostTypedData,
  signSetDispatcherTypedData,
  lensHub,
  splitSignature,
  validateMetadata,
} from "../api";
import { create } from "ipfs-http-client";
import { v4 as uuid } from "uuid";

const projectId = process.env.NEXT_PUBLIC_PROJECT_ID;
const projectSecret = process.env.NEXT_PUBLIC_PROJECT_SECRET;
const auth =
  "Basic " + Buffer.from(projectId + ":" + projectSecret).toString("base64");

const ipfsClient = create({
  host: "ipfs.infura.io",
  port: 5001,
  protocol: "https",
  headers: {
    authorization: auth,
  },
});

export default function Home() {
  const [address, setAddress] = useState();
  const [session, setSession] = useState(null);
  const [postData, setPostData] = useState("");
  const [videoData, setVideoData] = useState("");
  const [profileId, setProfileId] = useState("");
  const [handle, setHandle] = useState("");
  const [token, setToken] = useState("");
  const [isDispatcher, setIsDispatcher] = useState();

  useEffect(() => {
    checkConnection();
  }, []);
  async function checkConnection() {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const accounts = await provider.listAccounts();
    if (accounts.length) {
      setAddress(accounts[0]);
      const response = await client.query({
        query: getDefaultProfile,
        variables: { address: accounts[0] },
      });
      setProfileId(response.data.defaultProfile.id);
      setHandle(response.data.defaultProfile.handle);
    }
  }
  async function connect() {
    const account = await window.ethereum.send("eth_requestAccounts");
    if (account.result.length) {
      setAddress(account.result[0]);
      const response = await client.query({
        query: getDefaultProfile,
        variables: { address: accounts[0] },
      });
      setProfileId(response.data.defaultProfile.id);
      console.log("profileId: ", profileId);
      setHandle(response.data.defaultProfile.handle);
    }
  }
  async function login() {
    try {
      const challengeInfo = await client.query({
        query: challenge,
        variables: {
          address,
        },
      });
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const signature = await signer.signMessage(
        challengeInfo.data.challenge.text
      );
      const authData = await client.mutate({
        mutation: authenticate,
        variables: {
          address,
          signature,
        },
      });

      const {
        data: {
          authenticate: { accessToken },
        },
      } = authData;
      localStorage.setItem("lens-auth-token", accessToken);
      setToken(accessToken);
      setSession(authData.data.authenticate);
    } catch (err) {
      console.log("Error signing in: ", err);
    }
  }

  async function checkIfDispatcher() {
    try {
      const isDispatcher = await client.query({
        query: checkDispatcher,
        variables: {
          profileId
        }
      });
      console.log("isDispatcher: ", isDispatcher);
      setIsDispatcher(isDispatcher.data.profile.dispatcher)
      console.log("isDispatcher: ", isDispatcher.data.profile.dispatcher);
    } catch (err) {
      console.log("Error checking if dispatcher: ", err);
    }
  }

  async function setDispatcher() {
    try {
      const setDispatcherRequest = {
        profileId,
      };

      const signedResult = await signSetDispatcherTypedData(
        setDispatcherRequest,
      );

      console.log("signedResult: ", signedResult);

      const typedData = signedResult.result.typedData;
      const { v, r, s } = splitSignature(signedResult.signature);
      const tx = await lensHub.setDispatcherWithSig({
        profileId: typedData.value.profileId,
        dispatcher: typedData.value.dispatcher,
        sig: {
          v,
          r,
          s,
          deadline: typedData.value.deadline,
        },
      });
      console.log("successfully set dispatcher: tx hash", tx.hash);
    } catch (err) {
      console.log("error setting dispatcher: ", err);
    }
  }

  async function createPost() {
    if (!postData) return;
    const ipfsData = await uploadToIPFS();

    const createPostRequest = {
      profileId,
      contentURI: "ipfs://" + ipfsData.path,
      collectModule: {
        freeCollectModule: { followerOnly: true },
      },
      referenceModule: {
        followerOnlyReferenceModule: false,
      },
    };
    try {
      console.log("posting publication: ", createPostRequest);
      console.log("token: ", token);
      checkIfDispatcher();

      const signedResult = await signCreatePostTypedData(
        createPostRequest,
        token
      );

      const typedData = signedResult.result.typedData;
      const { v, r, s } = splitSignature(signedResult.signature);
      const tx = await lensHub.postWithSig({
        profileId: typedData.value.profileId,
        contentURI: typedData.value.contentURI,
        collectModule: typedData.value.collectModule,
        collectModuleInitData: typedData.value.collectModuleInitData,
        referenceModule: typedData.value.referenceModule,
        referenceModuleInitData: typedData.value.referenceModuleInitData,
        sig: {
          v,
          r,
          s,
          deadline: typedData.value.deadline,
        },
      });
      console.log("successfully created post: tx hash", tx.hash);
    } catch (err) {
      console.log("error posting publication: ", err);
    }
  }

  async function uploadMediaToIPFS() {
    if (!videoData) return;
    console.log("Uploading video to IPFS");
    console.log(videoData)
    const added = await ipfsClient.add(videoData);
    console.log("-----------------")
    return added;
  }

  async function uploadToIPFS() {
    let videoURL = await uploadMediaToIPFS();

    console.log(videoURL)


    const metaData = {
      version: "2.0.0",
      content: postData,
      description: postData,
      name: postData,
      external_url: `https://lenstube.xyz/${handle}`,
      metadata_id: uuid(),
      mainContentFocus: "VIDEO",
      attributes: [],
      locale: "en-US",
      media: [
        {
          type: "video/mp4",
          item: `ipfs://${videoURL.path}`,
        },
      ],
      appId: videoURL ? "lenstube" : "lensfrens",
    };

    const result = await client.query({
      query: validateMetadata,
      variables: {
        metadatav2: metaData,
      },
    });
    console.log("Metadata verification request: ", result);

    const added = await ipfsClient.add(JSON.stringify(metaData));
    return added;
  }
  function onChange(e) {
    setPostData(e.target.value);
    console.log(postData, videoData);
  }
  function onFileChange(e) {
    setVideoData(e.target.files[0]);
    console.log(videoData);
  }
  return (
    <div>
      {!address && <button onClick={connect}>Connect</button>}
      {address && !session && (
        <div onClick={login}>
          <button>Login</button>
        </div>
      )}
      <div>
        <h1>Address: {address}</h1>
        <h1>Profile ID: {profileId}</h1>
        <h1>Handle: {handle}</h1>
        <h1>Dispatcher: {isDispatcher}</h1>
      </div>
      {address && session && (
        <div>
          <textarea onChange={onChange} />
          <input type="file" onChange={onFileChange} />
          <button onClick={createPost}>Create Post</button>
          <button onClick={setDispatcher}>Set Dispatcher</button>
        </div>
      )}
    </div>
  );
}
