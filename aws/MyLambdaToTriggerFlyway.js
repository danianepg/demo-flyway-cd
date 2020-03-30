/**
 * MyLambdaToTriggerFlyway
 *
 * This lambda relies on 3 environment variables: ENV_CLUSTER, ENV_SUBNET, ENV_SECURITY_GROUP.
 * 
 */

var aws = require('aws-sdk');
var ecs = new aws.ECS();

exports.handler = async (event, context) => {
    
	var taskDefinition = null;

	var CLUSTER = process.env.ENV_CLUSTER;
	var SUBNET = process.env.ENV_SUBNET.split(",");
	var SECURITY_GROUP = process.env.ENV_SECURITY_GROUP;
	var LAUNCH_TYPE = "FARGATE";
	var FAMILY_PREFIX = "flyway";
	var CONTAINER_NAME = "flyway";	
	
	var taskParams = {
		familyPrefix: FAMILY_PREFIX
	};    

	const listTaskDefinitionsResult = await ecs.listTaskDefinitions(taskParams).promise();
    
	if(listTaskDefinitionsResult) {
		taskDefinition = listTaskDefinitionsResult.taskDefinitionArns[listTaskDefinitionsResult.taskDefinitionArns.length-1];
		taskDefinition = taskDefinition.split("/")[1];
	}

	var params = {
        cluster: CLUSTER,
        count: 1, 
        launchType: LAUNCH_TYPE,
        networkConfiguration: {
            "awsvpcConfiguration":  {
              "subnets": SUBNET,
              "securityGroups": [SECURITY_GROUP]
            }
        },
        taskDefinition: taskDefinition,
       
	};
    
	const runTaskResult = await ecs.runTask(params).promise();
  
	if (runTaskResult.failures && runTaskResult.failures.length > 0) {
		console.log("Error!");
		console.log(runTaskResult.failures);
	}

	return runTaskResult;
   
};
