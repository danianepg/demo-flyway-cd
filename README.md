
# Building a continuous delivery pipeline for database migrations with GitLab and AWS


![](https://miro.medium.com/max/4173/0*p3ro-JNVb5arxGH3)

Photo by  [JJ Ying](https://unsplash.com/@jjying?utm_source=medium&utm_medium=referral)  on  [Unsplash](https://unsplash.com/?utm_source=medium&utm_medium=referral)

After  [having tested tools](https://medium.com/@danianepg/database-migrations-with-liquibase-and-flyway-5946379c7738?source=friends_link&sk=3d73f41cf8d50a0bba38ab0fc0bb6cd5)  to automate the database migrations, it is time to integrate the chosen one with my GitLab repository and build a continuous delivery pipeline for AWS.

----------

## Project stack

You can check my previous story about a comparison between Flyway and Liquibase  [here](https://medium.com/@danianepg/database-migrations-with-liquibase-and-flyway-5946379c7738?source=friends_link&sk=3d73f41cf8d50a0bba38ab0fc0bb6cd5), but *spoiler alert* this implementation has the following stack:

-   [Flyway](https://flywaydb.org/)  manage database migrations.
-   MySQL database.
-   Flyway  [Docker](https://www.docker.com/get-started) image.
-   [GitLab CI/CD](https://docs.gitlab.com/ee/ci/docker/using_kaniko.html).
-   [Amazon Web Services (AWS)](https://aws.amazon.com/).
-   [Check the repository here](https://github.com/danianepg/demo-flyway-cd).

## The process

-   GitLab CI builds a Flyway Docker image and pushes it to Amazon  [Elastic Container Registry](https://aws.amazon.com/ecr/) (ECR).
-   GitLab CI triggers a lambda that runs an Amazon  [Elastic Container Service](https://aws.amazon.com/ecs/)  (ECS) task with the Flyway Docker image from ECR.
-   The Flyway command “_migrate_” is executed and the database schema is updated.

The image below illustrates the process.


![](https://miro.medium.com/max/936/1*vb9muCFGPEJjCICZnFkjug.jpeg)

The continuous delivery pipeline process

## GitLab CI

A  [demo project](https://github.com/danianepg/demo-flyway-cd)  has the folder  [_db-migrations/scripts_](https://github.com/danianepg/demo-flyway-cd/tree/master/db-migrations/scripts)  where migration scripts are placed. Every time a change is pushed to this folder on GitLab repository, the pipeline will run, build a Flyway Docker image with the scripts and push it to the Amazon Elastic Container Registry (ECR).

Additionally, GitLab CI triggers a lambda that calls an Amazon Elastic Container Service (ECS) task which will run the built image.

The image details are on the  [_Dockerfile_](https://github.com/danianepg/demo-flyway-cd/blob/master/db-migrations/Dockerfile) below.

```
# Get image "flyway" from Flyway's repository
FROM flyway/flyway

WORKDIR /flyway 

# Database credentials
COPY db-migrations/flyway.conf /flyway/conf

# Add the scripts I've pushed to my project folder to the Docker image
ADD db-migrations/scripts /flyway/sql

# Execute the command migrate
CMD [ "migrate" ]
```




The following  [_.gitlab-ci.yml_](https://github.com/danianepg/demo-flyway-cd/blob/master/gitlab-ci.yml)  shows GitLab’s actions. Check stages “_build-docker-image_” and “_execute-migrations_”.


```
stages:
  - build-docker-image
  - execute-migrations
  
build-docker-image:
  stage: build-docker-image
  image:
    name: gcr.io/kaniko-project/executor:debug-v0.19.0
    entrypoint: [""]
  script:
    - echo "{\"auths\":{\"$CI_REGISTRY\":{\"username\":\"$CI_REGISTRY_USER\",\"password\":\"$CI_REGISTRY_PASSWORD\"}}}" > /kaniko/.docker/config.json    
    - /kaniko/executor --context $CI_PROJECT_DIR --dockerfile $CI_PROJECT_DIR/db-migrations/Dockerfile --destination $AWS_REPOS_FLYWAY:latest
  only:
    refs:
      - <MY_BRANCH_ON_GITLAB>
    changes:
      - db-migrations/scripts/*

execute-migrations:
  stage: execute-migrations
  image: python:3.8-alpine
  before_script:
    - apk add --no-cache python3
    - python3 -m pip install awscli
  script:
    - aws lambda invoke --function-name MyLambdaToTriggerFlyway response.json
  only:
    refs:
      - <MY_BRANCH_ON_GITLAB>
    changes:
      - db-migrations/scripts/*
```



## Lambda

The lambda is not strictly required: the same results could be achieved using the CLI.

However, a lambda offers more flexibility to the process. It is possible to get the execution results, send emails, feed a database table with information to collect statistics and everything else your imagination allows.

Also, it keeps the infrastructure control through the code and its versions.

The  [lambda](https://github.com/danianepg/demo-flyway-cd/blob/master/aws/MyLambdaToTriggerFlyway.js)  was written in Node.js 12.x and I have reused the code I  [wrote for another test](https://medium.com/@danianepg/triggering-an-amazon-ecs-from-amazon-rds-5425b807fe82). The task is triggered on line 47 with the command “_ecs.runTask(params)_”.

```javascript
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
```



## Elastic Container Service Task

The ECS task gets the Flyway Docker image and runs it. The command “_migrate_” will be executed, the scripts will be applied and the database schema will be updated.

In case of errors, I have decided to keep the fix execution manual for now, but it would be possible to automatize the usage of other commands such as “_validate_” and “_repair_”.

I have created an alarm on  [CloudWatch](https://aws.amazon.com/pt/cloudwatch/)  to notify me by email in case of any error. For future implementation, I intent to manage execution errors through the lambda.

## Conclusions

It can be painful to manage database migrations manually, especially if we have multiple environments such as development, staging or production.

However, a migration tool like Flyway integrated with a continuous delivery pipeline, avoid manual execution and therefore mitigates human error. Furthermore, it relieves the burden and boredom of the activity.

----------

_This article was written in partnership with_ [_Elson Neto._](https://medium.com/@ealmeidaneto)

*Originally posted on my [Medium Stories](https://medium.com/@danianepg/building-a-continuous-delivery-pipeline-for-database-migrations-with-gitlab-and-aws-c81b47f1a56a?source=friends_link&sk=7e4fd4828fdc09b13e19464c310d2520)*
