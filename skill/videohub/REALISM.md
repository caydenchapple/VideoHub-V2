# Realism guide: real physics, natural motion, still a cartoon

The goal of every film made through VideoHub: it must look **believable and hand-made**, not generated. Realistic means the
*rules* are real (gravity, weight, contact, light). Cartoonish means the *amplitude* is exaggerated (squash, stretch, timing, bold
colour) **on top of** those rules, never instead of them. A cartoon that obeys physics reads as charming; one that ignores it reads
as broken.

Read this before building a film, and again before you call `hub_review`.

## 1. Physics that must be true

| Thing | Rule |
|---|---|
| Units | 1 unit = 1 metre, y is up. A person is ~1.7 m, a door 2 m, a ball 0.2 m. Keep scale consistent in the whole film. |
| Gravity | `g = 9.81 m/s²`. A free body: `y = y0 + v0·t − 4.905·t²`. Step it with sub-steps (120 Hz) and semi-implicit Euler, or use the closed form. |
| Cartoon allowance | Up to ~1.3× g (a snappier fall) or a short hang at the top of a jump. Never zero (floating) and never a constant speed in the air. |
| Falling | Speed grows every frame. A body that falls at a steady speed looks like a puppet on a wire. Light things (feathers, paper, a parachute) reach a terminal speed from air drag: `v_t = sqrt(2 m g / (ρ Cd A))`; show them speeding up, then settling. |
| Landing | Contact ends a fall with an *event*: bounce (restitution: rubber 0.8, wood 0.5, metal 0.3, flesh/sand 0.1), squash, dust, a settle. Never a dead stop from full speed in one frame. Every bounce is lower than the last (`h' = e²·h`). |
| Support | Nothing hovers. Every body either rests on something (its bottom touches the ground or another body), is moving ballistically, or is held by something visible (a rope, a hand, a rocket). Birds, balloons and ghosts are `flying`. |
| Contact | A body that rests on the ground has its lowest point exactly on the ground. A contact shadow sits under it. A body that is moving has a shadow that follows and fades with height. |
| No interpenetration | Two solid bodies never share space. A hand holds a cup: the cup is the hand's *child*. Use collision bounds and push apart; do not let a crate sink into a floor or a limb pass through a torso. |
| Momentum | A moving heavy thing does not stop at once. It decelerates with friction (`a = μ g`), or hits something and transfers momentum. A light thing hit by a heavy one flies off faster than the heavy one moves. |
| Balance | A thing that is not supported over its centre of mass falls over (a tall tower leans before it goes). |
| Water, smoke, cloth | Follow the motion of what moves them with lag; they never move by themselves. |

## 2. Natural motion (the twelve principles, kept physical)

- **Ease**: slow in, slow out for anything driven by a person or a camera; a camera moves with a motive and never starts at full speed.
- **Arcs**: living things and thrown things move in arcs, not straight lines.
- **Anticipation**: a short move the other way before a big move (a crouch before a jump).
- **Follow-through and overlap**: hair, tails, coats, antennae lag behind and settle (damped spring, 2–3 oscillations, then rest). Settle fully: a spring that never settles looks like a wobble bug.
- **Squash and stretch**: on contact squash by 10–25 % and on fast motion stretch along the velocity, always **preserving volume** (`sx·sy·sz ≈ 1`). Only for a few frames around the impact.
- **Timing**: heavy = slow to start, slow to stop. Light = quick. The same action at two weights must look different.
- **One source of motion per object.** Two animations fighting over the same object (a wobble on top of a spring on top of noise) is the main cause of jitter.
- **Noise is smooth.** Handheld camera, wind, breathing: low-frequency noise of *time* (`noise(t·0.8)`), never `Math.random()` per frame, never a random offset per frame.
- **Feet plant.** A walking character's foot does not slide on the ground while it is down.

## 3. Not looking generated ("AI slop")

The tells, and what to do about each:

| Tell | Make it right |
|---|---|
| Shapes or textures that swim, boil or morph from frame to frame | Fixed geometry. Textures belong to the surface (object-space coordinates), not to the screen. Procedural patterns use the object's own coordinates and a fixed seed. |
| Identity drift (a face, a shirt colour, a number of fingers changes) | One definition per character and prop, reused every frame. Limbs keep their lengths. |
| Objects that overlap or merge where they touch | Collision bounds; parent/child for held things; clear gaps. |
| Floating things, missing contact shadows | Section 1: support and contact. |
| Lighting that jumps or points two ways | One key light direction per scene; shadows agree with it; a light change is eased over frames or sits on a cut. |
| Flicker, pops, one-frame glitches | Deterministic functions of `t`; no state that carries over between frames; no unseeded random. |
| Mushy, soft detail, smeared edges | Draw crisp shapes at the output resolution; avoid unnecessary blur. |
| Default poses (everyone stands in a T-pose / identical idle) | Give each character a pose and a small asymmetric idle (weight on one leg, a blink, a breath). |
| Gibberish text, inconsistent scale | Real text rendered as text; the same object keeps its size between shots. |
| Sliding, teleporting, objects appearing | Animate every entrance; if it appears, it appears behind something or on a cut. |
| Everything perfectly symmetrical or evenly spaced | Vary spacing, size and timing a little (seeded), as a hand would. |

## 4. Tell VideoHub where your objects are (exact checks)

The review can only *guess* physics from the picture. Give it the truth: define `window.VH_BODIES` next to `renderOut`, a function of
time that returns the objects of the scene. It costs a few lines and turns on exact checks for overlaps, ground penetration,
floating, gravity, teleporting, size pops and jitter.

```js
// every body: id (stable), pos [x, y, z] in metres (y up) = its CENTRE, size [w, h, d] full extents in metres (or r for a sphere radius)
// optional: static (never moves), grounded (rests on a surface: skips the gravity check), flying (held up on purpose),
//           parent (id of what it is attached to: overlap allowed), allowOverlap, teleports (a deliberate jump), scales (a deliberate size change)
window.VH_SCALE = { metersPerHeight: 3.2, ground: 0 };   // how many metres the picture is tall (for the picture-based gravity check); y of the ground
window.VH_BODIES = t => {
  const s = simulate(t);                                   // the same function that draws the frame
  return [
    { id: 'ball', pos: [s.ball.x, s.ball.y, s.ball.z], r: 0.11, grounded: s.ball.onGround },
    { id: 'crate', pos: [2, 0.25, 0], size: [0.5, 0.5, 0.5], static: true },
  ];
};
```

Rules: call it with the same `t` as `renderOut(t)`; it must be pure (no state); report **every body that matters** (characters as one or a
few boxes: torso, head), not every vertex. Bodies that are children of another (a hat) carry `parent`.

## 5. The loop

1. Build the film from the template. Simulate physics from real constants (section 1) and expose `VH_BODIES` (section 4).
2. When it plays: `hub_review({ project })`. It returns findings (errors, warnings, info) with times and what to change, plus pictures:
   a contact sheet of the whole film and frames of the worst moments.
3. **Look at the pictures yourself** with the checklist below. The automatic checks find motion problems; only you can see that a
   character looks wrong.
4. Fix every error and every warning that is not on purpose. Re-run `hub_review`. Repeat until it is clean (usually 2–3 rounds).
   Use `hub_frames({ project, times: [...] })` to look at any moment closely.
5. Only then `hub_live` and `hub_wait_for_notes`: the user's notes arrive in the tool, nothing is pasted.

## 6. Checklist for looking at the pictures

- Does any object float, sink into the ground, or overlap another? Does every resting object have a shadow under it?
- Does the motion look weighted? Would a heavy thing really move like that? Does it start and stop with some give?
- Is anything stretched, squashed or changed in size without a reason? Are volumes preserved?
- Do light and shadows agree (one direction, one colour)? Any sudden colour or brightness jump?
- Are characters the same character in every frame (colours, proportions, limb count)?
- Does any texture or edge look unstable, smeared, or too uniform?
- Is the composition readable at phone size? Is text legible?
- Is it still a cartoon: bold shapes, clear silhouettes, exaggerated expression and timing, on top of believable physics?
