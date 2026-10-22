# WebThinker Check my work (v1.3)

Adds a **Check my work** bar under a student's p5.js sketch. The student picks a task, types the 2-letter key shown in their Moodle quiz, and clicks **Check**. If their canvas matches the task, they get a 4-letter **unlock code** that only works with their key. If not, they see their canvas with the differences marked in red.

## How it works

1. The checker runs the student's lesson file and the task's solution in 2 hidden frames, in the same browser, with the same random seed.
2. It steps both to the same frames and compares them pixel by pixel. A pixel only counts as different if no matching colour is within 2 pixels of it in the other picture.
3. On a match, it makes an unlock code from the task's secret and the student's key.
4. The Moodle quiz gave that student one of 400 versions of the question, each with its own key, and accepts only that key's unlock code. A friend with a different key gets a different unlock code.

The student's visible sketch is never changed.

## Files

| File | What it is | Upload to GitHub? |
| --- | --- | --- |
| `checker.js` | The engine | Yes |
| `tasks/L02.js` | Scrambled task list for 1.02 | Yes |
| `README.md` | This guide (contains no answers) | Yes |
| `build-tasks.js` | Scrambles a readable task list | No |
| `make-moodle-questions.js` | Writes the Moodle question files | No |
| `tasks-src/L02.js` | Readable task list with solutions and secrets | **No, keep private** |
| `moodle/*.xml` | Question files to import into Moodle | **No, keep private** |
| `moodle/L02 keys and codes (teacher only).csv` | Every key and its code | **No, keep private** |

## Set up GitHub (once)

1. Create a public repository `wt-checker`. Upload only `checker.js`, `README.md` and the `tasks` folder with the scrambled files.
2. In **Settings > Pages**, publish from the `main` branch, root folder.
3. The starter project's **index.html** loads the checker after the p5.js lines and before the lesson file:

   ```html
   <script src="https://<account>.github.io/wt-checker/checker.js"></script>
   ```

## Set up Moodle (each lesson)

**1. Import the questions**

For each task file in `moodle/` (for example `L02 2F Mouse face.xml`):

1. Open the question bank you use for the course and create a category with the same name, for example `L02 2F Mouse face`.
2. Go to **Import**, choose **Moodle XML format**, and select that category as the destination. Untick **Get category from file**.
3. Upload the file. You should see 400 questions, `2F key BC`, `2F key BD` ...

**2. Make one unlock quiz per Part**

Name it exactly as in the task list's `typeOn`: the Part it opens (`Unlock Part 2` after Part 1, ... `Unlock Wrap Up` after the last Part). Place it straight after the Part's H5P book.

- **Questions:** Add, **a random question**, from that task's category. Part 4 has 3 drawings, so add 3 random questions, one from each of its 3 categories.
- **Attempts allowed:** Unlimited. **Grading method:** Highest grade.
- **Each attempt builds on the last: No.** Each new attempt then draws a new key.
- **Review options: untick "Right answer" in every column.**
- **Completion:** Receive a passing grade. Set **Grade to pass** to the quiz's full mark.

**3. Gate the next Part**

On each Part's H5P book after Part 1, and on Wrap Up, add **Restrict access**: Activity completion, the matching `Unlock ...` quiz, must be marked complete and pass grade. Quick Checks and the rest of each book stay optional.

## Add or change a lesson

1. Create or edit `tasks-src/L03.js` in the same shape as `tasks-src/L02.js`. `passCode` is the task's secret (4 capital consonants, different for every task); students never see it. `typeOn` is the name of the unlock quiz (`Unlock Part 2` ...).
2. Run `node build-tasks.js L03`. It checks the list and writes the scrambled `tasks/L03.js`.
3. Run `node make-moodle-questions.js L03`. It makes 400 versions per task (every possible key); add a number for fewer, for example `100`. It writes one XML file per task and the teacher-only CSV.
4. Upload `tasks/L03.js` to GitHub and import the XML files into Moodle.

**Never change a task's `passCode` after its questions are imported.** The imported answers depend on it. If you must change it, delete the old questions and import new ones.

Optional per-task settings: `frames` (default `[1]`; use `[1, 30, 60]` for moving sketches), `shiftTolerance` (pixels, default 2), `colourTolerance` (0 to 255, default 8), `maxDifferent` (share of pixels, default 0.0001).

## Tested

Chromium with p5.js 1.11.1, at normal and 2x screen density:

- **Drawing checks:** 25 cases, all as expected. Correct work for all 6 tasks of 1.02 passes, as do `ellipse()` used for a circle, a shape 1 pixel off, a moving ball over 60 frames and seeded random colours. Missing or moved shapes, wrong colours or order, and a wrong ball speed fail with red marks. A wrong canvas size and code errors give clear messages.
- **Keyed unlock codes:** the checker's unlock code matched the Moodle question's answer for every key sampled, typed in capitals or lower case. With no key or an invalid key, a passing student is told where to find their key.

## Not yet tested

- Importing the XML files into your Moodle 5.2 and running the quiz as a student.
- Safari, Firefox and Chromebooks.
- Real classes: the tolerances, and whether students manage the key step.
- Lessons with mouse, keyboard, timers or sound (1.04 onwards) need engine updates.

## Limits

- **2 students can get the same key.** With 400 versions, a given friend has your key 1 time in 400.
- **A student who has passed can make a friend's unlock code** by typing the friend's key into their own checker. This takes deliberate teamwork.
- **Scrambling stops a student who opens `tasks/L02.js`, not a determined one** who reads `checker.js` and knows JavaScript.
- **GitHub keeps old versions.** If a readable task list was ever uploaded, delete and recreate the repository: download what you need, delete it under **Settings > Danger Zone**, create it again with the same name, upload only the scrambled files, and turn Pages back on. The address stays the same.
