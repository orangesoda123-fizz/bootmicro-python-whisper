const express = require("express");
const path = require("path");
const axios = require("axios");
const { text } = require("stream/consumers");

if (!process.env.PORT) {
    throw new Error("Please specify the port number for the HTTP server with the environment variable PORT.");
}

const PORT = process.env.PORT;
const METADATA_SERVICE_URL = process.env.METADATA_SERVICE_URL || "http://metadata";
const HISTORY_SERVICE_URL = process.env.HISTORY_SERVICE_URL || "http://history";
const VIDEO_UPLOAD_SERVICE_URL = process.env.VIDEO_UPLOAD_SERVICE_URL || "http://video-upload";
const VIDEO_STREAMING_SERVICE_URL = process.env.VIDEO_STREAMING_SERVICE_URL || "http://video-streaming";
const EMPLOYEES_CRUD_URL = process.env.EMPLOYEES_CRUD_URL || "http://employees-crud:3000";
const PYTHON_WHISPER_URL = process.env.PYTHON_WHISPER_URL || "http://python-whisper";

//
// Application entry point.
//
async function main() {
    const app = express();

    app.set("views", path.join(__dirname, "views")); // Set directory that contains templates for views.
    app.set("view engine", "hbs"); // Use hbs as the view engine for Express.

    app.use(express.static("public"));

    // POST for employees 
    app.use(express.json());

    app.use(express.urlencoded({ extended: true }));

    //
    // Main web page that lists videos.
    //
    app.get("/", async (req, res) => {

        // Retreives the list of videos from the metadata microservice.
        const videosResponse = await axios.get(`${METADATA_SERVICE_URL}/videos`)

        // Renders the video list for display in the browser.
        res.render("video-list", { videos: videosResponse.data.videos });
    });

    app.get("/employees", async (req, res) => {
        try {
            const employeesResponse = await axios.get(`${EMPLOYEES_CRUD_URL}/employees`);

            res.render("employees", {
                employeesList: employeesResponse.data.employees,
                selectedEmployee: null,
                message: null,
                error: null,
                searchId: ""
            });
        }
        catch (err) {
            res.status(500).render("employees_test", {
                employeesList: [],
                selectedEmployee: null,
                message: null,
                error: "Could not load employees.",
                searchId: ""
            });
        }


    });

    app.get("/employees/:id", async (req, res) => {
        const employeeId = req.params.id;

        try {
            const [employeesResponse, employeeResponse] = await Promise.all([
                await axios.get(`${EMPLOYEES_CRUD_URL}/employees`),
                await axios.get(`${EMPLOYEES_CRUD_URL}/employees/${employeeId}`)
            ]);

            res.render("employees", {
                employeesList: employeesResponse.data.employees,
                selectedEmployee: employeeResponse.data.employee,
                message: null,
                error: null,
                searchId: employeeId
            });
        }
        catch (err) {
            let employeesList = [];

            try {
                const employeesResponse = await axios.get(`${EMPLOYEES_CRUD_URL}/employees`);

                employeesList = employeesResponse.data.employees;
            } catch (_) { }

            const notFound = err.response && err.response.status === 404;

            res.status(notFound ? 404 : 500).render("employees_test", {
                employeesList,
                selectedEmployee: null,
                message: null,
                error: notFound
                    ? `Employee with id ${employeeId} was not found.`
                    : "Could not retrieve employee.",
                searchId: employeeId
            });

        }

    });


    app.post("/employees", async (req, res) => {
        try {
            await axios.post(`${EMPLOYEES_CRUD_URL}/employees`, req.body);
            res.redirect("/employees");
        } catch (err) {
            const employeesResponse = await axios.get(`${EMPLOYEES_CRUD_URL}/employees`);

            res.status(400).render("employees", {
                employeesList: employeesResponse.data.employees,
                selectedEmployee: null,
                message: null,
                error: "Could not create employee. Check the form values.",
                searchId: ""
            });
        }
    });

    app.post("/employees/:id/update", async (req, res) => {
        const employeeId = req.params.id;

        try {
            await axios.put(`${EMPLOYEES_CRUD_URL}/employees/${employeeId}`, req.body);
            res.redirect(`/employees/${employeeId}`);
        }
        catch (err) {
            const employeesResponse = await axios.get(`${EMPLOYEES_CRUD_URL}/employees`);

            req.status(400).render("employees", {
                employeesList: employeesResponse.data.employees,
                selectedEmployee: { id: employeeId, ...req.body },
                message: null,
                error: "Could not update employee",
                searchId: employeeId
            });
        }
    });

    app.post("/employees/:id/delete", async (req, res) => {
        const employeeId = req.params.id;

        try {
            await axios.delete(`${EMPLOYEES_CRUD_URL}/employees/${employeeId}`);
            res.redirect("/employees");
        } catch (err) {
            const employeesResponse = await axios.get(`${EMPLOYEES_CRUD_URL}/employees`);

            res.status(400).render("employees", {
                employeesList: employeesResponse.data.employees,
                selectedEmployee: null,
                message: null,
                error: "Could not delete employee",
                searchId: employeeId
            });
        }

    });

    /**app.put("/employees/:id", async (req, res) => {
        const employeeId = req.params.id;
        const response = await axios.put(
            `${EMPLOYEES_CRUD_URL}/employees/${employeeId}`, req.body
        );
    
        res.redirect("/employees");
    });
    
    app.delete("/employees/:id", async (req, res) => {
        const employeeId = req.params.id;
        const response = await axios.delete(
            `${EMPLOYEES_CRUD_URL}/employees/${employeeId}`
        );
    
        res.redirect("/employees");
    });**/

    //
    // Web page to play a particular video.
    //
    app.get("/video", async (req, res) => {

        const videoId = req.query.id;

        // Retreives the data from the metadata microservice.
        const videoResponse = await axios.get(`${METADATA_SERVICE_URL}/video?id=${videoId}`)

        const video = {
            metadata: videoResponse.data.video,
            url: `/api/video?id=${videoId}`,
        };

        // Renders the video for display in the browser.
        res.render("play-video", { video });
    });

    //
    // Web page to upload a new video.
    //
    app.get("/upload", (req, res) => {
        res.render("upload-video", {});
    });

    //
    // Web page to show the users viewing history.
    //
    app.get("/history", async (req, res) => {

        // Retreives the data from the history microservice.
        const historyResponse = await axios.get(`${HISTORY_SERVICE_URL}/history`)

        // Renders the history for display in the browser.
        res.render("history", { videos: historyResponse.data.history });
    });


    app.post("/transcribe-video/redirect", async (req, res) => {
        const textResponse = await axios({
            method: "POST",
            url: `${PYTHON_WHISPER_URL}/transcribe-video`,
            data: req,
            responseType: "stream",
            headers: {
                "content-type": req.headers["content-type"],
                "file-name": req.headers["file-name"]
            }
        });

        return textResponse.data.pipe(res);
    });


    app.get("/transcribe-video/redirect/:id", async (req, res) => {
        const videoId = req.params.id;

        const textResponse = await axios.post(
            `${PYTHON_WHISPER_URL}/transcribe-video/${videoId}`
        );

        await axios.put(
            `${METADATA_SERVICE_URL}/video/${videoId}/transcript`,
            {
                transcript: textResponse.data.transcript
            }
        );

        const videosResponse = await axios.get(`${METADATA_SERVICE_URL}/videos`);


        res.render("video-list", {
            videos: videosResponse.data.videos,
        });

    });

    // create a microservice that calls a new microservice video_streaming 
    // from video_streaming call python microservice with id. 
    // return result. 

    //
    // HTTP GET route that streams video to the user's browser.
    //
    app.get("/api/video", async (req, res) => {

        const response = await axios({ // Forwards the request to the video-streaming microservice.
            method: "GET",
            url: `${VIDEO_STREAMING_SERVICE_URL}/video?id=${req.query.id}`,
            data: req,
            responseType: "stream",
        });
        response.data.pipe(res);
    });



    //
    // HTTP POST route to upload video from the user's browser.
    //
    app.post("/api/upload", async (req, res) => {

        const response = await axios({ // Forwards the request to the video-upload microservice.
            method: "POST",
            url: `${VIDEO_UPLOAD_SERVICE_URL}/upload`,
            data: req,
            responseType: "stream",
            headers: {
                "content-type": req.headers["content-type"],
                "file-name": req.headers["file-name"],
            },
        });
        response.data.pipe(res);
    });

    app.listen(PORT, () => {
        console.log("Microservice online.");
    });


}

main()
    .catch(err => {
        console.error("Microservice failed to start.");
        console.error(err && err.stack || err);
    });