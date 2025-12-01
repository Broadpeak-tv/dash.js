# Proposal for DASH seekable live sliding window

### Challenges of large live DVR windows in MPEG-DASH Streaming

The MPEG-DASH standard, along with the DASH-IF Interoperability Points (IOP), provides clear guidelines for implementing live streaming using DASH. A key concept in live DASH streaming is the __sliding segment window__, which is exposed to clients through the manifest (MPD). This list evolves over time according to the timeShiftBufferDepth parameter, defining the amount of content available for time-shifted playback.

When the live service offers a large DVR window—for example, several hours of past content—the manifest can become significantly large. This increase in size is driven by several factors:
1.	__Irregular Timelines__
In live workflows, segment durations may not be perfectly uniform due to encoder behavior or clock drift. This irregularity requires explicit signaling of segment’s timing in the MPD, increasing the manifest size.
2.	__Splicing and Ad Insertion (SSAI)__
Server-Side Ad Insertion introduces discontinuities in the timeline. To represent these transitions correctly, the MPD often uses multiple Periods, each with its own segment list and metadata. This segmentation adds complexity and contributes to manifest growth.
3.	__Multi-Period Structures__
Beyond SSAI, multi-period setups are also used for events with program changes or different content rights. Each Period requires its own set of segment references, further inflating the MPD.
4.	__Frequent Updates__
For live streaming, the MPD must be updated regularly to reflect newly available segments and remove expired ones. When the DVR window spans several hours, the manifest update process involves handling thousands of segment entries, which can lead to:
o	Increased network traffic for MPD refreshes.
o	Higher parsing and processing overhead on the client side.

#### Impact and Considerations

•	__Bandwidth usage__: Large MPDs consume more bandwidth especially when the manifests need to be updated regularly.
•	__Startup time and latency__:  Largs MPDs can take significant amount of computing time when being parsed by the clients, especially on low-end resources devices such as Smart TVs or Stick TVs, impacting significantly startup time. This delay is therefore disadvantageous for a live viewing experience. In extreme cases, startup latency can exceed multiple seconds, significantly degrading Quality of Experience.
•	__Client Resource Usage__: Parsing large manifests can strain memory and CPU, especially on constrained devices.
•	__Scalability__: Frequent delivery of large MPDs to millions of clients can stress CDN and origin servers.

A set of solutions are already available to reduce the manifest size and or manifest updates, such as SegmentTimeline patterns to address timelines irregularity due to encoder behavior, or MPD delta updates based on MPD Patching to deliver incremental updates to reduce overhead.

Nevertheless, there is no guaranteed method to ensure the manifests remain compact under all service configurations during all startup and updates steps. Even with existing optimizations, certain scenarios, especially those involving long DVR windows and multi-periods will inevitably lead to large manifests.

### Proposed Solution: Seekable live sliding DVR window

#### Concept Overview

Traditional MPEG-DASH live streaming exposes a sliding segment list within the MPD, controlled by timeShiftBufferDepth. This allows clients to seek within a limited time-shift window. 
The proposed solution attempts to resolve the problem statement which can be reformulated as:
•	How can we enable players to seek within a DVR window without downloading/updating full DVR period(s) and timelines?
•	How can we enable a player to seek/join a live stream in the past and play as if it were in the past, but with a small shifting buffer (timeShiftBufferDepth)?

The solution proposes a mechanism to provide past manifests, enabling clients to seek back in time and continue the live session as if they were watching live at that past moment. Instead of keeping one massive MPD, the system offers short, time-bounded manifests corresponding to different points in the live timeline.

From a technical point of view the system consists of:
•	providing a compact time-bounded manifest but along with the information of a larger whole DVR window with available segments on the origin in which the player can seek back.
•	and providing means to enable clients to retrieve a manifest from the past, which manifest contains the segment list (and periods) of the content at the targeted seeking time.
The solution is illustrated on the figure below.

<img width="987" height="511" alt="image" src="https://github.com/user-attachments/assets/803217a9-6fe5-41eb-bcba-628fc6e8a179" />


From a client perspective, when the user wants to seek back at a given time @t, the process would consist in:
1.	Downloading the manifest from the past as it was published at the seeking time. As a result, the fetched manifest will contain the segments window description at the targeted seeking time, but only for the same short timeShiftbufferDepth as in live edge manifest.
2.	Update the segments timeline according to the new manifest
3.	Seek within this new timeline to the initial requested seeking time
4.	Restarts the MPD updates scheduler with same update period but while incrementing the manifest as if the client were playing the content in the past.
 
#### New signalization

The proposed approach relies on introducing additional signaling within the DASH specification to enable past manifest retrieval and full DVR window signalization.

This signaling would allow clients to discover and request manifests corresponding to past points in the live timeline, effectively extending the concept of timeShiftBufferDepth beyond a single MPD.

The proposed signaling extensions are:
*	`MPD@extTimeShiftBufferDepth` attribute to signal full time-shifting buffer (DVR)
*	`<LocationTemplate/>` element to signal how to retrieve past MPDs:
    -    within the full DVR window
    -    and as it was published at the requested time

    With the following attributes:
    -    `@mpd`: the template to create the MPD URL
    -    `@period`: the constant MPD duration (update frequency)
    -    `@startNumber`: the number of the first MPD from @availabilityStartTime

*	`MPD@type="extDynamic"` to signal new MPD type for seeked manifest out of current live window, to avoid interoperability issues with legacy DASH clients

As for segments, the proposal is to provide a template to download the manifest according to the seeking time.

As for segments template, the `<LocationTemplate/>` attributes `@period` and `@startNumber` enable to determine the URL of the targeted manifest.

Below is an example of a live manifest (`/manifest.mpd`) with this additional signalization:

<img width="666" height="234" alt="image" src="https://github.com/user-attachments/assets/168fd720-f35c-4ccd-b0e6-0e73c6997d1f" />

Based on the signalization contained in this manifest, if the client wants to seek back for example 2 hours ago from current time, it must fetch the manifest as published 2 hours ago, i.e. at the published epoch time 2025-01-01T10:00:00.00Z.

Conforming to the provided `<LocationTemplate/>`, the number of the target manifest is determined as follows:

```
%Number% = Number of sec. (targetPublishTime - @availabilityStartTime) / @period
         = 1735725630 / 2
         = 867862815
```

Resulting fetched manifest (`/manifest?n=867862815`):

<img width="666" height="234" alt="image" src="https://github.com/user-attachments/assets/218ae809-4975-425f-b3f8-816c9da85c2b" />

#### Conclusion

The proposed solution introduces new signaling within the DASH specification to enable past manifest retrieval and large DVR session simulation. By allowing clients to request short, time-bounded manifests for past points in the live timeline, this approach eliminates the need for oversized MPDs while preserving interoperability and scalability. 
This mechanism not only improves startup and zapping times but also enhances user experience by enabling flexible catch-up and replay capabilities, while reducing and optimizing overall bandwidth usage.
