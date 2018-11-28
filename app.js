var dataGenerator = require('./tools/dataGenerator.js');
var dataInjector = require('./tools/data-injector.js');
var apiInjector = require('./tools/httpRequestsAdapter.js');
var fs = require('fs');
var Q = require('q');
var env = process.env.ENV || 'test';
var kinesisStream = env + '-InteractionMetadata';
var tenantId, buID, fileStorageUri, sessionToken, emailAdd, password = 'Aa123456';
var host = 'https://na1.' + env + '.nice-incontact.com';
var now = new Date();
var userByEnv = {
    test: {
        user: 'Madhvi1@to32.com',
        tenant: '11e8bc93-12c6-c130-bb6c-0242ac110004',
        buid: '1126004210',
        agentId: '11e8bc93-1c47-9db0-8465-0242ac110003',
    }
};
var fileStorageEndpointByEnv = {
    dev: 'https://aitxpyof72.execute-api.us-west-2.amazonaws.com/beta/api/v2.0/',
    test: 'https://aitxpyof72.execute-api.us-west-2.amazonaws.com/beta/api/v2.0/'
};
var loginAndGetTokenData = {
    action: 'POST',
    uri: host + '/public/user/login',
    authorization: '',
    contentType: 'application/json',
    body: '',
    timeout: 30000,
    logMessage: 'Requiring session Token',
    actionType: 'GETTOKEN'
};

var interactionToTest = dataGenerator.prepareInteraction('videoWithZoom');

prepareTests(userByEnv[env],interactionToTest);

function prepareTests(userData, interaction) {
    emailAdd = userData.user;
    tenantId = userData.tenant;
    buID = userData.buid;
    loginAndGetTokenData.body = JSON.stringify({email: emailAdd, password: password});
    fileStorageUri = fileStorageEndpointByEnv[env] + buID + '/files/';
    return dataInjector.initAwsCredentials(env).then(function () {
        return apiInjector.sendRequest(loginAndGetTokenData, 5);
    })
        .then(function (response) {
            sessionToken = JSON.parse(response).token;
            return uploadMediaFilesToFileStorage(interaction['fs']);
        }, rejectDeferred)
        .then(function () {
            return injectToKinesis(interaction['sdr']);
        }, rejectDeferred)
}

function uploadMediaFilesToFileStorage(recordings) {
    var promises = [];
    recordings.forEach(function (recording) {
        recording.body.Metadata.startTime = new Date(recording.body.Metadata.startTime + now.getTime()).toISOString();
        recording.body.Metadata.endTime = new Date(recording.body.Metadata.endTime + now.getTime()).toISOString();
        recording.body.BusinessUnit = buID;
        recording.uri = fileStorageUri;
        recording.authorization = sessionToken;
        promises.push(apiInjector.sendRequest(recording, 5)
            .then(readMediaFile, rejectDeferred)
            .then(function (mediaFileData) {
                return apiInjector.sendRequest(mediaFileData, 5);
            }));
    });
    return Q.all(promises);
}
function rejectDeferred(error) {
    console.log("####", error);
    throw error;
}

function readMediaFile(response) {
    var mediaFileData = {
        action: 'PUT',
        uri: '',
        contentType: 'application/x-www-form-urlencoded',
        body: '',
        timeout: 50000,
        logMessage: '',
        actionType: 'FILEUPLOAD'
    };
    var filePath = response.filePath;
    var deferred = Q.defer();
    fs.readFile(filePath, function (err, data) {
        if (err) throw err;
        mediaFileData.uri = response.SignedUrl;
        mediaFileData.body = data;
        mediaFileData.logMessage = 'uploading media file: ' + filePath;
        deferred.resolve(mediaFileData);
    });
    return deferred.promise;

}
function injectToKinesis(interactions) {
    var records = [];
    interactions.forEach(function (interaction) {
        records.push(setRecordData(interaction, now));
    });
    return dataInjector.insertRecordsToStream(kinesisStream, 'partition', records);
}

function setRecordData(record, startTime) {
    record.startTime = new Date(record.startTime + startTime.getTime()).toISOString();
    record.endTime = new Date(record.endTime + startTime.getTime()).toISOString();
    record.wrapUpTime = new Date(record.wrapUpTime + startTime.getTime()).toISOString();
    record.segmentContactStartTime = new Date(record.segmentContactStartTime + startTime.getTime()).toISOString();
    record.participants[0].userId = userByEnv[env].agentId;
    record.recordings.forEach(function (rec) {
        rec.startTime = new Date(rec.startTime + startTime.getTime()).toISOString();
        rec.endTime = new Date(rec.endTime + startTime.getTime()).toISOString();
    });
    record.tenantId = tenantId;
    return JSON.parse(JSON.stringify(record));
}